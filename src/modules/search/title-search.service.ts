import { withDbClient } from '../../lib/db.js';
import { ShortLivedRequestCoalescer } from '../../lib/request-coalescer.js';
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

type SearchCandidate = CatalogItem & {
  normalizedTitle: string;
  normalizedSubtitle: string;
  sourcePriority: number;
};

type SearchBucketEntry = {
  item: CatalogItem;
  noisy: boolean;
};

type SearchBuckets = {
  movies: SearchBucketEntry[];
  series: SearchBucketEntry[];
  anime: SearchBucketEntry[];
};

type SearchEntryCandidate = SearchBucketEntry & {
  normalizedTitle: string;
  normalizedSubtitle: string;
  sourcePriority: number;
};

const MOVIES_LIMIT = 20;
const SERIES_LIMIT = 20;
const ANIME_LIMIT = 20;
const ALL_LIMIT = 60;
const SEARCH_CACHE_TTL_MS = 3_000;

export class TitleSearchService {
  constructor(
    private readonly tmdbCacheService = new TmdbCacheService(),
    private readonly contentIdentityService = new ContentIdentityService(),
    private readonly providerMetadataService = new ProviderMetadataService(),
    private readonly requestCoalescer = new ShortLivedRequestCoalescer<MetadataSearchResponse>(SEARCH_CACHE_TTL_MS),
  ) {}

  async searchTitles(input: SearchTitlesInput): Promise<MetadataSearchResponse> {
    const normalizedQuery = input.query.trim();
    const normalizedFilter = normalizeSearchFilter(input.filter);
    const genreMapping = resolveGenreMapping(input.genre);
    const limit = input.limit ?? 20;
    const locale = normalizeSearchLocale(input.locale);

    if (!normalizedQuery && !genreMapping) {
      return emptySearchResponse(normalizedQuery);
    }

    const mediaTypes = mapSearchFilterToTmdbTypes(normalizedFilter);
    const requestKey = buildSearchRequestKey({
      query: normalizedQuery,
      filter: normalizedFilter,
      genreMapping,
      limit,
      locale,
    });

    return this.requestCoalescer.run(requestKey, () => withDbClient(async (client) => {
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

        const item = toCatalogItem(buildMetadataCardView({
          identity,
          title: match,
        }));
        return item ? { item, noisy: isNoisyTmdbMatch(match) } : null;
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
        return item ? [{ item, noisy: isNoisyProviderMatch(match) }] : [];
      });

      return buildBucketedSearchResponse(normalizedQuery, limit, [
        ...tmdbItems.filter((item): item is SearchBucketEntry => item !== null),
        ...providerItems,
      ]);
    }));
  }
}

function emptySearchResponse(query: string): MetadataSearchResponse {
  return {
    query,
    all: [],
    movies: [],
    series: [],
    anime: [],
  };
}

function buildSearchRequestKey(params: {
  query: string;
  filter: MetadataSearchFilter;
  genreMapping: GenreMapping | null;
  limit: number;
  locale: string | null;
}): string {
  const genreKey = params.genreMapping
    ? `${params.genreMapping.movieGenreId}:${params.genreMapping.tvGenreId ?? ''}`
    : '';
  return [params.query, params.filter, genreKey, String(params.limit), params.locale ?? ''].join('|');
}

export function mapSearchFilterToTmdbTypes(filter: MetadataSearchFilter): TmdbTitleType[] {
  if (filter === 'movies' || filter === 'all') {
    return ['movie'];
  }
  return [];
}

function normalizeSearchLocale(value: string | null | undefined): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/.test(normalized) ? normalized : null;
}

function normalizeSearchFilter(filter: MetadataSearchFilter | null | undefined): MetadataSearchFilter {
  return filter === 'movies' || filter === 'series' || filter === 'anime' ? filter : 'all';
}

function matchesSearchFilter(match: TmdbTitleRecord, filter: MetadataSearchFilter): boolean {
  if (filter === 'movies' || filter === 'all') {
    return match.mediaType === 'movie';
  }
  return false;
}

function shouldQueryTmdb(filter: MetadataSearchFilter): boolean {
  return filter === 'movies' || filter === 'all';
}

function normalizeGenreKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function rankSearchEntries(query: string, entries: SearchBucketEntry[]): SearchBucketEntry[] {
  const seen = new Set<string>();
  return entries
    .filter(({ item }) => {
      const key = `${item.mediaType}:${item.provider}:${item.providerId}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .map((entry) => ({
      ...entry,
      normalizedTitle: normalizeSearchText(entry.item.title),
      normalizedSubtitle: normalizeSearchText(entry.item.subtitle),
      sourcePriority: entry.item.mediaType === 'movie' ? 0 : 1,
    }))
    .sort(compareSearchEntries(query))
    .map(({ normalizedTitle: _normalizedTitle, normalizedSubtitle: _normalizedSubtitle, sourcePriority: _sourcePriority, ...entry }) => entry);
}

function buildSearchBuckets(items: SearchBucketEntry[]): SearchBuckets {
  const buckets: SearchBuckets = {
    movies: [],
    series: [],
    anime: [],
  };

  for (const entry of items) {
    if (!hasSearchPoster(entry.item)) {
      continue;
    }

    const bucket = bucketForMediaType(entry.item.mediaType);
    if (bucket) {
      buckets[bucket].push(entry);
    }
  }

  return buckets;
}

function buildBucketedSearchResponse(query: string, limit: number, entries: SearchBucketEntry[]): MetadataSearchResponse {
  const buckets = buildSearchBuckets(entries);
  const movies = finalizeBucket(query, buckets.movies, Math.min(limit, MOVIES_LIMIT));
  const series = finalizeBucket(query, buckets.series, Math.min(limit, SERIES_LIMIT));
  const anime = finalizeBucket(query, buckets.anime, Math.min(limit, ANIME_LIMIT));
  const all = finalizeBucket(query, [...movies, ...series, ...anime], Math.min(limit * 3, ALL_LIMIT));

  return {
    query,
    all: toCatalogItems(all),
    movies: toCatalogItems(movies),
    series: toCatalogItems(series),
    anime: toCatalogItems(anime),
  };
}

function finalizeBucket(query: string, items: SearchBucketEntry[], limit: number): SearchBucketEntry[] {
  const ranked = rankSearchEntries(query, items);
  return moveNoisyItemsToEnd(ranked).slice(0, limit);
}

function moveNoisyItemsToEnd(items: SearchBucketEntry[]): SearchBucketEntry[] {
  const clean: SearchBucketEntry[] = [];
  const noisy: SearchBucketEntry[] = [];

  for (const item of items) {
    if (item.noisy) {
      noisy.push(item);
    } else {
      clean.push(item);
    }
  }

  return [...clean, ...noisy];
}

function hasSearchPoster(item: CatalogItem): boolean {
  return Boolean(item.posterUrl?.trim());
}

function toCatalogItems(entries: SearchBucketEntry[]): CatalogItem[] {
  return entries.map(({ item }) => item);
}

function bucketForMediaType(mediaType: CatalogItem['mediaType']): keyof SearchBuckets | null {
  if (mediaType === 'movie') {
    return 'movies';
  }
  if (mediaType === 'show') {
    return 'series';
  }
  if (mediaType === 'anime') {
    return 'anime';
  }
  return null;
}

function compareSearchEntries(query: string): (left: SearchEntryCandidate, right: SearchEntryCandidate) => number {
  const normalizedQuery = normalizeSearchText(query);
  return (left, right) => {
    const leftRank = rankCatalogItem(normalizedQuery, left);
    const rightRank = rankCatalogItem(normalizedQuery, right);
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    const leftYear = left.item.releaseYear ?? Number.MIN_SAFE_INTEGER;
    const rightYear = right.item.releaseYear ?? Number.MIN_SAFE_INTEGER;
    if (leftYear !== rightYear) {
      return rightYear - leftYear;
    }

    const leftRating = left.item.rating ?? Number.MIN_SAFE_INTEGER;
    const rightRating = right.item.rating ?? Number.MIN_SAFE_INTEGER;
    if (leftRating !== rightRating) {
      return rightRating - leftRating;
    }

    if (left.sourcePriority !== right.sourcePriority) {
      return left.sourcePriority - right.sourcePriority;
    }

    return left.item.title.localeCompare(right.item.title);
  };
}

function isNoisyTmdbMatch(match: TmdbTitleRecord): boolean {
  return !hasDate(match.releaseDate ?? match.firstAirDate) && !hasText(match.overview);
}

function isNoisyProviderMatch(match: ProviderTitleRecord): boolean {
  if (match.provider === 'kitsu') {
    return !hasDate(match.releaseDate) && match.rating == null;
  }

  return !hasDate(match.releaseDate) && !hasText(match.overview) && !hasText(match.summary);
}

function hasDate(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

function hasText(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

function rankCatalogItem(query: string, item: Pick<SearchCandidate, 'normalizedTitle' | 'normalizedSubtitle'>): number {
  if (!query) {
    return 4;
  }

  if (item.normalizedTitle === query || item.normalizedSubtitle === query) {
    return 0;
  }
  if (item.normalizedTitle.startsWith(query) || item.normalizedSubtitle.startsWith(query)) {
    return 1;
  }
  if (item.normalizedTitle.includes(query) || item.normalizedSubtitle.includes(query)) {
    return 2;
  }
  return 3;
}

function normalizeSearchText(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? '';
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
