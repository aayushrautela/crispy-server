import type { DbClient } from '../../lib/db.js';
import { withDbClient } from '../../lib/db.js';
import { assertPresent, HttpError } from '../../lib/errors.js';
import type { SupportedMediaType } from '../watch/media-key.js';
import { inferMediaIdentity } from '../watch/media-key.js';
import { buildMetadataCardView } from './metadata-normalizers.js';
import { ContentIdentityService } from './content-identity.service.js';
import { MetadataViewService } from './metadata-view.service.js';
import { TmdbExternalIdResolverService } from './tmdb-external-id-resolver.service.js';
import { TmdbCacheService } from './tmdb-cache.service.js';
import type {
  MetadataResolveResponse,
  MetadataSearchResponse,
  MetadataSearchFilter,
  TmdbTitleRecord,
  MetadataTitleDetail,
  MetadataSeasonDetail,
  TmdbTitleType,
} from './tmdb.types.js';

type ResolveInput = {
  id?: string;
  tmdbId?: number | null;
  imdbId?: string | null;
  tvdbId?: number | null;
  mediaType?: SupportedMediaType | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
};

type SearchTitlesInput = {
  query: string;
  limit?: number;
  filter?: MetadataSearchFilter | null;
  genre?: string | null;
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
      const identity = await this.contentIdentityService.resolveMediaIdentity(client, id);
      if (identity.mediaType === 'episode') {
        return this.metadataViewService.getTitleDetail(client, {
          ...identity,
          mediaType: 'show',
          mediaKey: `show:tmdb:${identity.showTmdbId}`,
          tmdbId: identity.showTmdbId,
          seasonNumber: null,
          episodeNumber: null,
        });
      }

      return this.metadataViewService.getTitleDetail(client, identity);
    });
  }

  async getSeasonDetailByShowId(showId: string, seasonNumber: number): Promise<MetadataSeasonDetail> {
    return withDbClient(async (client) => {
      const identity = await this.contentIdentityService.resolveMediaIdentity(client, showId);
      if (identity.mediaType !== 'show' || !identity.tmdbId) {
        throw new HttpError(400, 'Season details require a show id.');
      }

      return this.metadataViewService.getSeasonDetail(client, identity.tmdbId, seasonNumber);
    });
  }

  async searchTitles(input: SearchTitlesInput): Promise<MetadataSearchResponse> {
    const normalizedQuery = input.query.trim();
    const normalizedFilter = normalizeSearchFilter(input.filter);
    const genreMapping = resolveGenreMapping(input.genre);
    const limit = input.limit ?? 20;

    if (!normalizedQuery && !genreMapping) {
      return {
        query: normalizedQuery,
        items: [],
      };
    }

    const mediaTypes = mapSearchFilterToTmdbTypes(normalizedFilter);
    return withDbClient(async (client) => {
      const matches = genreMapping
        ? await this.tmdbCacheService.discoverTitlesByGenre({
            movieGenreId: genreMapping.movieGenreId,
            tvGenreId: genreMapping.tvGenreId,
            filter: normalizedFilter,
            limit,
          })
        : await this.tmdbCacheService.searchTitles(normalizedQuery, limit, mediaTypes);
      const filteredMatches = matches.filter((match) => matchesSearchFilter(match, normalizedFilter));
      const identities = filteredMatches.map((match) => inferMediaIdentity({
        mediaType: match.mediaType === 'movie' ? 'movie' : 'show',
        tmdbId: match.tmdbId,
      }));
      const contentIds = await this.contentIdentityService.ensureContentIds(client, identities);
      const items = await Promise.all(filteredMatches.map(async (match: TmdbTitleRecord) => {
        const identity = inferMediaIdentity({
          mediaType: match.mediaType === 'movie' ? 'movie' : 'show',
          tmdbId: match.tmdbId,
        });
        const contentId = contentIds.get(identity.mediaKey) ?? await this.contentIdentityService.ensureContentId(client, identity).catch(() => null);
        if (!contentId) {
          return null;
        }

        return buildMetadataCardView({
          id: contentId,
          identity,
          title: match,
        });
      }));

      return {
        query: normalizedQuery,
        items: items.filter((item): item is MetadataSearchResponse['items'][number] => item !== null),
      };
    });
  }

  private async resolveIdentity(client: DbClient, input: ResolveInput) {
    if (input.id?.trim()) {
      return this.contentIdentityService.resolveMediaIdentity(client, input.id.trim());
    }

    const mediaType = normalizeResolveMediaType(input.mediaType, input.seasonNumber, input.episodeNumber);
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

function normalizeSearchFilter(filter: MetadataSearchFilter | null | undefined): MetadataSearchFilter {
  return filter === 'movies' || filter === 'series' ? filter : 'all';
}

function matchesSearchFilter(match: TmdbTitleRecord, filter: MetadataSearchFilter): boolean {
  if (filter === 'movies') {
    return match.mediaType === 'movie';
  }
  if (filter === 'series') {
    return match.mediaType === 'tv';
  }
  return true;
}

export function mapSearchFilterToTmdbTypes(filter: MetadataSearchFilter): TmdbTitleType[] {
  if (filter === 'movies') {
    return ['movie'];
  }
  if (filter === 'series') {
    return ['tv'];
  }
  return ['movie', 'tv'];
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
  if (mediaType === 'movie' || mediaType === 'show' || mediaType === 'episode') {
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
