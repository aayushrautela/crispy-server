import type { DbClient } from '../../lib/db.js';
import { withDbClient } from '../../lib/db.js';
import { assertPresent, HttpError } from '../../lib/errors.js';
import type { MediaIdentity, SupportedMediaType } from '../identity/media-key.js';
import { inferMediaIdentity, parseMediaKey } from '../identity/media-key.js';
import { buildMetadataCardView, buildProviderMetadataCardView, toCatalogItem } from './metadata-normalizers.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { MetadataViewService } from './metadata-view.service.js';
import { ProviderMetadataService } from './provider-metadata.service.js';
import { TmdbExternalIdResolverService } from './providers/tmdb-external-id-resolver.service.js';
import { TmdbCacheService } from './providers/tmdb-cache.service.js';
import type {
  MetadataResolveResponse,
  MetadataSearchFilter,
  MetadataSeasonDetail,
  MetadataSearchResponse,
  MetadataTitleDetail,
  ProviderTitleRecord,
} from './metadata.types.js';
import type {
  TmdbTitleType,
  TmdbTitleRecord,
} from './providers/tmdb.types.js';

type ResolveInput = {
  id?: string;
  tmdbId?: number | null;
  imdbId?: string | null;
  tvdbId?: number | null;
  kitsuId?: string | number | null;
  mediaType?: SupportedMediaType | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
};

type SearchTitlesInput = {
  query: string;
  limit?: number;
  filter?: MetadataSearchFilter | null;
  genre?: string | null;
  locale?: string | null;
};

type GenreMapping = {
  movieGenreId: number;
  tvGenreId?: number | null;
};

export class MetadataQueryService {
  constructor(
    private readonly metadataViewService = new MetadataViewService(),
    private readonly externalIdResolver = new TmdbExternalIdResolverService(),
    private readonly tmdbCacheService = new TmdbCacheService(),
    private readonly contentIdentityService = new ContentIdentityService(),
    private readonly providerMetadataService = new ProviderMetadataService(),
  ) {}

  async resolve(input: ResolveInput): Promise<MetadataResolveResponse> {
    return withDbClient(async (client) => {
      const identity = await this.resolveIdentity(client, input);
      return {
        item: await this.metadataViewService.buildMetadataView(client, identity),
      };
    });
  }

  async getTitleDetailById(id: string): Promise<MetadataTitleDetail> {
    return withDbClient(async (client) => {
      const identity = await resolveTitleRouteIdentity(client, this.contentIdentityService, id);
      if (identity.mediaType !== 'movie' && identity.mediaType !== 'show' && identity.mediaType !== 'anime') {
        throw new HttpError(400, 'Title details require a title id.');
      }

      return this.metadataViewService.getTitleDetail(client, identity);
    });
  }

  async getSeasonDetailByShowId(showId: string, seasonNumber: number): Promise<MetadataSeasonDetail> {
    return withDbClient(async (client) => {
      const identity = await resolveShowRouteIdentity(client, this.contentIdentityService, showId);
      if (identity.mediaType !== 'show' && identity.mediaType !== 'anime') {
        throw new HttpError(400, 'Season details require a show id.');
      }

      return this.metadataViewService.getSeasonDetail(client, identity, seasonNumber);
    });
  }

  async searchTitles(input: SearchTitlesInput): Promise<MetadataSearchResponse> {
    const normalizedQuery = input.query.trim();
    const normalizedFilter = normalizeSearchFilter(input.filter);
    const genreMapping = resolveGenreMapping(input.genre);
    const limit = input.limit ?? 20;
    const locale = normalizeSearchLocale(input.locale);

    if (!normalizedQuery && !genreMapping) {
      return {
        query: normalizedQuery,
        items: [],
      };
    }

    const mediaTypes = mapSearchFilterToTmdbTypes(normalizedFilter);
    return withDbClient(async (client) => {
      const tmdbMatches = shouldQueryTmdb(normalizedFilter)
        ? genreMapping
          ? await this.tmdbCacheService.discoverTitlesByGenre({
              movieGenreId: genreMapping.movieGenreId,
              tvGenreId: genreMapping.tvGenreId,
              filter: normalizedFilter,
              limit,
            })
          : await this.tmdbCacheService.searchTitles(normalizedQuery, limit, mediaTypes, locale)
        : [];
      const filteredTmdbMatches = tmdbMatches.filter((match) => matchesSearchFilter(match, normalizedFilter));
      const providerMatches = normalizedQuery || normalizedFilter === 'anime' || normalizedFilter === 'series'
        ? await this.providerMetadataService.searchTitles(client, normalizedQuery, normalizedFilter, limit)
        : [];

      const tmdbIdentities = filteredTmdbMatches.map((match) => inferMediaIdentity({
        mediaType: match.mediaType === 'movie' ? 'movie' : 'show',
        tmdbId: match.tmdbId,
      }));

      const providerIdentities = providerMatches.map((match) => inferMediaIdentity({
        mediaType: match.mediaType,
        provider: match.provider,
        providerId: match.providerId,
      }));

      const contentIds = await this.contentIdentityService.ensureContentIds(client, [
        ...tmdbIdentities,
        ...providerIdentities,
      ]);

      const tmdbItems = await Promise.all(filteredTmdbMatches.map(async (match: TmdbTitleRecord) => {
        const identity = inferMediaIdentity({
          mediaType: match.mediaType === 'movie' ? 'movie' : 'show',
          tmdbId: match.tmdbId,
        });
        const contentId = contentIds.get(identity.mediaKey) ?? await this.contentIdentityService.ensureContentId(client, identity).catch(() => null);
        if (!contentId) {
          return null;
        }

        return buildMetadataCardView({
          identity,
          title: match,
        });
      }));

      const providerItems = providerMatches.flatMap((match: ProviderTitleRecord) => {
        const identity = inferMediaIdentity({
          mediaType: match.mediaType,
          provider: match.provider,
          providerId: match.providerId,
        });
        const contentId = contentIds.get(identity.mediaKey);
        if (!contentId) {
          return [];
        }
        const item = toCatalogItem(buildProviderMetadataCardView({ identity, title: match }));
        return item ? [item] : [];
      });

      return {
        query: normalizedQuery,
        items: [
          ...tmdbItems
            .map((item) => (item ? toCatalogItem(item) : null))
            .filter((item): item is MetadataSearchResponse['items'][number] => item !== null),
          ...providerItems,
        ]
          .slice(0, limit),
      };
    });
  }

  private async resolveIdentity(client: DbClient, input: ResolveInput) {
    if (input.id?.trim()) {
      return this.contentIdentityService.resolveMediaIdentity(client, input.id.trim());
    }

    const mediaType = normalizeResolveMediaType(input.mediaType, input.seasonNumber, input.episodeNumber);

    if (mediaType === 'show' && typeof input.tvdbId === 'number' && Number.isInteger(input.tvdbId) && input.tvdbId > 0) {
      return inferMediaIdentity({
        mediaType: 'show',
        provider: 'tvdb',
        providerId: input.tvdbId,
      });
    }

    if (mediaType === 'anime' && input.kitsuId !== null && input.kitsuId !== undefined && String(input.kitsuId).trim()) {
      return inferMediaIdentity({
        mediaType: 'anime',
        provider: 'kitsu',
        providerId: input.kitsuId,
      });
    }

    if (mediaType === 'episode') {
      if (typeof input.tvdbId === 'number' && Number.isInteger(input.tvdbId) && input.tvdbId > 0) {
        if (input.seasonNumber === null || input.seasonNumber === undefined || input.episodeNumber === null || input.episodeNumber === undefined) {
          throw new HttpError(400, 'Episode resolution requires show id, season number, and episode number.');
        }

        return inferMediaIdentity({
          mediaType: 'episode',
          provider: 'tvdb',
          parentProvider: 'tvdb',
          parentProviderId: input.tvdbId,
          seasonNumber: input.seasonNumber,
          episodeNumber: input.episodeNumber,
        });
      }

      if (input.kitsuId !== null && input.kitsuId !== undefined && String(input.kitsuId).trim()) {
        if (input.seasonNumber === null || input.seasonNumber === undefined || input.episodeNumber === null || input.episodeNumber === undefined) {
          throw new HttpError(400, 'Episode resolution requires anime id, season number, and episode number.');
        }

        return inferMediaIdentity({
          mediaType: 'episode',
          provider: 'kitsu',
          parentProvider: 'kitsu',
          parentProviderId: input.kitsuId,
          seasonNumber: input.seasonNumber,
          episodeNumber: input.episodeNumber,
        });
      }
    }

    const showTmdbId = await this.resolveTmdbId(client, input, mediaType);

    if (mediaType === 'episode') {
      if (!showTmdbId || input.seasonNumber === null || input.seasonNumber === undefined || input.episodeNumber === null || input.episodeNumber === undefined) {
        throw new HttpError(400, 'Episode resolution requires show id, season number, and episode number.');
      }

      return inferMediaIdentity({
        mediaType: 'episode',
        showTmdbId,
        seasonNumber: input.seasonNumber,
        episodeNumber: input.episodeNumber,
      });
    }

    const tmdbId = assertPresent(showTmdbId, 'Unable to resolve metadata identity.');
    return inferMediaIdentity({
      mediaType,
      tmdbId,
    });
  }

  private async resolveTmdbId(
    client: DbClient,
    input: ResolveInput,
    mediaType: SupportedMediaType,
  ): Promise<number | null> {
    if (typeof input.tmdbId === 'number' && Number.isInteger(input.tmdbId) && input.tmdbId > 0) {
      return input.tmdbId;
    }

    if (input.imdbId?.trim()) {
      return this.externalIdResolver.resolve(client, {
        source: 'imdb_id',
        externalId: input.imdbId,
        mediaType: normalizeTmdbResolvableMediaType(mediaType),
      });
    }

    if (typeof input.tvdbId === 'number' && Number.isInteger(input.tvdbId) && input.tvdbId > 0) {
      return this.externalIdResolver.resolve(client, {
        source: 'tvdb_id',
        externalId: String(input.tvdbId),
        mediaType: normalizeTmdbResolvableMediaType(mediaType),
      });
    }

    return null;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function resolveTitleRouteIdentity(
  client: DbClient,
  contentIdentityService: ContentIdentityService,
  id: string,
): Promise<MediaIdentity> {
  const normalizedId = id.trim();
  if (UUID_RE.test(normalizedId)) {
    return contentIdentityService.resolveMediaIdentity(client, normalizedId);
  }

  const identity = parseMediaKey(normalizedId);
  if (identity.mediaType !== 'movie' && identity.mediaType !== 'show' && identity.mediaType !== 'anime') {
    throw new HttpError(400, 'Title details require a title id.');
  }

  return identity;
}

export async function resolveShowRouteIdentity(
  client: DbClient,
  contentIdentityService: ContentIdentityService,
  id: string,
): Promise<MediaIdentity> {
  const identity = await resolveTitleRouteIdentity(client, contentIdentityService, id);
  if (identity.mediaType !== 'show' && identity.mediaType !== 'anime') {
    throw new HttpError(400, 'Season details require a show id.');
  }

  return identity;
}

function normalizeSearchLocale(value: string | null | undefined): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/.test(normalized) ? normalized : null;
}

function normalizeSearchFilter(filter: MetadataSearchFilter | null | undefined): MetadataSearchFilter {
  return filter === 'movies' || filter === 'series' || filter === 'anime' ? filter : 'all';
}

function matchesSearchFilter(match: TmdbTitleRecord, filter: MetadataSearchFilter): boolean {
  if (filter === 'movies') {
    return match.mediaType === 'movie';
  }
  if (filter === 'series') {
    return match.mediaType === 'tv';
  }
  if (filter === 'anime') {
    return false;
  }
  return true;
}

export function mapSearchFilterToTmdbTypes(filter: MetadataSearchFilter): TmdbTitleType[] {
  if (filter === 'movies') {
    return ['movie'];
  }
  if (filter === 'series' || filter === 'anime') {
    return [];
  }
  return ['movie', 'tv'];
}

function shouldQueryTmdb(filter: MetadataSearchFilter): boolean {
  return filter !== 'series' && filter !== 'anime';
}

function normalizeGenreKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function resolveGenreMapping(genre: string | null | undefined): GenreMapping | null {
  if (!genre?.trim()) {
    return null;
  }

  const genreMap: Record<string, GenreMapping> = {
    action: { movieGenreId: 28, tvGenreId: 10759 },
    animated: { movieGenreId: 16, tvGenreId: 16 },
    comedy: { movieGenreId: 35, tvGenreId: 35 },
    documentary: { movieGenreId: 99, tvGenreId: 99 },
    drama: { movieGenreId: 18, tvGenreId: 18 },
    family: { movieGenreId: 10751, tvGenreId: 10751 },
    fantasy: { movieGenreId: 14, tvGenreId: 10765 },
    horror: { movieGenreId: 27 },
    mystery: { movieGenreId: 9648, tvGenreId: 9648 },
    romance: { movieGenreId: 10749 },
    scifi: { movieGenreId: 878, tvGenreId: 10765 },
    thriller: { movieGenreId: 53 },
  };

  return genreMap[normalizeGenreKey(genre)] ?? null;
}

function normalizeResolveMediaType(
  mediaType: SupportedMediaType | null | undefined,
  seasonNumber: number | null | undefined,
  episodeNumber: number | null | undefined,
): SupportedMediaType {
  if (mediaType === 'movie' || mediaType === 'show' || mediaType === 'anime' || mediaType === 'episode') {
    return mediaType;
  }

  if (seasonNumber !== null && seasonNumber !== undefined && episodeNumber !== null && episodeNumber !== undefined) {
    return 'episode';
  }

  return 'movie';
}

function normalizeTmdbResolvableMediaType(mediaType: SupportedMediaType): 'movie' | 'show' | 'episode' {
  return mediaType === 'episode' ? 'episode' : mediaType === 'show' ? 'show' : 'movie';
}
