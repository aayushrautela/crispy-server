import { withDbClient } from '../../lib/db.js';
import { inferMediaIdentity } from '../identity/media-key.js';
import { buildMetadataCardView, buildProviderMetadataCardView, toCatalogItem } from '../metadata/metadata-card.builders.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { ProviderMetadataService } from '../metadata/provider-metadata.service.js';
import { TmdbCacheService } from '../metadata/providers/tmdb-cache.service.js';
import type { CatalogItem } from '../metadata/metadata-card.types.js';
import type { MetadataSearchFilter, MetadataSearchResponse, ProviderTitleRecord } from '../metadata/metadata-detail.types.js';
import type { TmdbTitleRecord, TmdbTitleType } from '../metadata/providers/tmdb.types.js';

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

export class TitleSearchService {
  constructor(
    private readonly tmdbCacheService = new TmdbCacheService(),
    private readonly contentIdentityService = new ContentIdentityService(),
    private readonly providerMetadataService = new ProviderMetadataService(),
  ) {}

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
            .filter((item): item is CatalogItem => item !== null),
          ...providerItems,
        ].slice(0, limit),
      };
    });
  }
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
