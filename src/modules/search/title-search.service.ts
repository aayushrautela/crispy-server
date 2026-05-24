import type { DbClient } from '../../lib/db.js';
import { withDbClient } from '../../lib/db.js';
import { ShortLivedRequestCoalescer } from '../../lib/request-coalescer.js';
import { inferMediaIdentity } from '../identity/media-key.js';
import { buildMetadataCardView } from '../metadata/metadata-card.builders.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { encodePublicItemId } from '../identity/public-item-id.js';
import { TmdbCacheService } from '../metadata/providers/tmdb-cache.service.js';
import { metadataCardToMediaItem, mediaItemToBaseItemDto } from '../metadata/media-item.mapper.js';
import type { BaseItemDto } from '../metadata/media-item.types.js';
import type { MetadataPersonSearchResult, MetadataSearchFilter, MetadataSearchResponse, MetadataSearchResult, SearchSuggestionItem } from '../metadata/metadata-detail.types.js';
import { normalizeMetadataLanguage } from '../metadata/metadata-language.js';
import type { TmdbPersonRecord, TmdbTitleRecord, TmdbTitleType } from '../metadata/providers/tmdb.types.js';

type SearchTitlesInput = {
  query: string;
  limit?: number;
  filter?: MetadataSearchFilter | null;
  genre?: string | null;
  locale?: string | null;
  signal?: AbortSignal;
};

type GenreMapping = {
  movieGenreId: number;
  tvGenreId?: number | null;
};

type SearchBucketEntry = {
  item: MetadataSearchResult;
  noisy: boolean;
};

type SearchBuckets = {
  movies: SearchBucketEntry[];
  series: SearchBucketEntry[];
};

type SearchEntryCandidate = SearchBucketEntry & {
  normalizedTitle: string;
  normalizedSubtitle: string;
  sourcePriority: number;
};

const MOVIES_LIMIT = 20;
const SERIES_LIMIT = 20;
const ALL_LIMIT = 60;
const SEARCH_CACHE_TTL_MS = 3_000;
const HYDRATION_CONCURRENCY = 3;

export class TitleSearchService {
  constructor(
    private readonly tmdbCacheService = new TmdbCacheService(),
    private readonly contentIdentityService = new ContentIdentityService(),
    private readonly requestCoalescer = new ShortLivedRequestCoalescer<MetadataSearchResponse>(SEARCH_CACHE_TTL_MS),
    private readonly suggestionCoalescer = new ShortLivedRequestCoalescer<SearchSuggestionItem[]>(SEARCH_CACHE_TTL_MS),
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
      abortable: Boolean(input.signal),
    });

    return this.requestCoalescer.run(requestKey, () => withDbClient(async (client) => {
      const tmdbMatches = shouldQueryTmdb(normalizedFilter)
        ? genreMapping
          ? await this.tmdbCacheService.discoverTitlesByGenre(client, {
              movieGenreId: genreMapping.movieGenreId,
              tvGenreId: genreMapping.tvGenreId,
              filter: normalizedFilter,
              limit,
            })
          : await this.tmdbCacheService.searchTitles(client, normalizedQuery, limit, mediaTypes, locale, input.signal)
        : [];
      const filteredTmdbMatches = tmdbMatches.filter((match) => matchesSearchFilter(match, normalizedFilter));

      const peopleMatches = shouldSearchPeople(normalizedFilter) && normalizedQuery
        ? await this.tmdbCacheService.searchPeople(client, normalizedQuery, limit)
        : [];

      const tmdbIdentities = filteredTmdbMatches.map((match) => inferMediaIdentity({
        mediaType: match.mediaType === 'movie' ? 'movie' : 'show',
        tmdbId: match.tmdbId,
      }));

      const contentIds = await this.contentIdentityService.ensureContentIds(client, tmdbIdentities);

      const hydratedMap = await this.tmdbCacheService.getTitles(
        client,
        filteredTmdbMatches.map((m) => ({ mediaType: m.mediaType, tmdbId: m.tmdbId })),
        locale,
        input.signal,
      );

      const tmdbItems = await mapWithConcurrency(filteredTmdbMatches, HYDRATION_CONCURRENCY, async (match: TmdbTitleRecord) => {
        if (input.signal?.aborted) {
          return null;
        }
        const identity = inferMediaIdentity({
          mediaType: match.mediaType === 'movie' ? 'movie' : 'show',
          tmdbId: match.tmdbId,
        });
        const contentId = contentIds.get(identity.mediaKey) ?? await this.contentIdentityService.ensureContentId(client, identity).catch(() => null);
        if (!contentId) {
          return null;
        }

        const hydrated = hydratedMap.get(`${match.mediaType}:${match.tmdbId}`);
        if (!hydrated) {
          return null;
        }

        const itemId = encodePublicItemId(contentId);
        const card = buildMetadataCardView({
          identity,
          itemId,
          title: hydrated,
          language: locale,
        });
        return {
          item: mediaItemToBaseItemDto(metadataCardToMediaItem(card, { itemId })),
          noisy: isNoisyTmdbMatch(hydrated),
        };
      });

      const peopleItems = await mapWithConcurrency(peopleMatches, HYDRATION_CONCURRENCY, async (person) => buildPersonSearchResult(client, this.contentIdentityService, person));

      return buildBucketedSearchResponse(normalizedQuery, limit, [
        ...tmdbItems.filter((item): item is NonNullable<(typeof tmdbItems)[number]> => item !== null),
      ], peopleItems);
    }));
  }

  async resolveAiCandidate(input: {
    query: string;
    mediaType: 'movie' | 'tv' | null;
    locale?: string | null;
    signal?: AbortSignal;
  }): Promise<MetadataSearchResult | null> {
    const normalizedQuery = input.query.trim();
    if (!normalizedQuery) {
      return null;
    }

    const locale = normalizeSearchLocale(input.locale);
    const mediaTypes: TmdbTitleType[] = input.mediaType ? [input.mediaType] : ['movie', 'tv'];

    return withDbClient(async (client) => {
      const rawMatches = await this.tmdbCacheService.searchTitles(client, normalizedQuery, 3, mediaTypes, locale, input.signal);
      if (rawMatches.length === 0) {
        return null;
      }

      const best = pickBestAiMatch(normalizedQuery, rawMatches);
      if (!best) {
        return null;
      }

      const identity = inferMediaIdentity({
        mediaType: best.mediaType === 'movie' ? 'movie' : 'show',
        tmdbId: best.tmdbId,
      });
      const contentId = await this.contentIdentityService.ensureContentId(client, identity);
      if (!contentId) {
        return null;
      }

      const hydrated = await this.tmdbCacheService.getTitle(client, best.mediaType, best.tmdbId, locale, input.signal);
      if (!hydrated) {
        return null;
      }

      const itemId = encodePublicItemId(contentId);
      const card = buildMetadataCardView({ identity, itemId, title: hydrated, language: locale });
      return mediaItemToBaseItemDto(metadataCardToMediaItem(card, { itemId }));
    });
  }

  async suggestTitles(input: SearchTitlesInput): Promise<SearchSuggestionItem[]> {
    const normalizedQuery = input.query.trim();
    const normalizedFilter = normalizeSearchFilter(input.filter);
    const locale = normalizeSearchLocale(input.locale);
    const limit = Math.min(input.limit ?? 8, 10);

    if (normalizedQuery.length < 2) {
      return [];
    }

    if (normalizedFilter === 'people') {
      return [];
    }

    const suggestionKey = [normalizedQuery, normalizedFilter, locale ?? '', String(limit)].join('|');

    return this.suggestionCoalescer.run(suggestionKey, () =>
      withDbClient(async (client) => {
        const suggestions = await this.tmdbCacheService.searchSuggestions(client, normalizedQuery, limit, normalizedFilter, locale);
        const identities = suggestions.flatMap((suggestion) => {
          const tmdbId = Number(suggestion.ProviderIds.Tmdb);
          if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
            return [];
          }
          return [inferMediaIdentity({
            mediaType: suggestion.Type === 'Movie' ? 'movie' : 'show',
            tmdbId,
          })];
        });
        const contentIds = await this.contentIdentityService.ensureContentIds(client, identities);

        return suggestions.map((suggestion) => {
          const tmdbId = Number(suggestion.ProviderIds.Tmdb);
          if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
            return suggestion;
          }
          const identity = inferMediaIdentity({
            mediaType: suggestion.Type === 'Movie' ? 'movie' : 'show',
            tmdbId,
          });
          const contentId = contentIds.get(identity.mediaKey);
          return contentId ? { ...suggestion, Id: encodePublicItemId(contentId) } : suggestion;
        });
      }),
    );
  }
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let index = 0; index < items.length; index += concurrency) {
    const batch = items.slice(index, index + concurrency);
    results.push(...await Promise.all(batch.map(mapper)));
  }
  return results;
}

function emptySearchResponse(query: string): MetadataSearchResponse {
  return {
    query,
    all: [],
    movies: [],
    series: [],
    people: [],
  };
}

async function buildPersonSearchResult(client: DbClient, contentIdentityService: ContentIdentityService, person: TmdbPersonRecord): Promise<MetadataPersonSearchResult> {
  const contentId = await contentIdentityService.ensurePersonContentId(client, {
    provider: 'tmdb',
    providerId: person.tmdbPersonId,
    metadata: { name: person.name },
  });

  return {
    kind: 'person_search_result',
    personId: encodePublicItemId(contentId),
    name: person.name,
    knownForDepartment: person.knownForDepartment,
    profileUrl: person.profilePath ? `https://image.tmdb.org/t/p/w185${person.profilePath}` : null,
    knownForTitles: person.knownFor
      .map((kf) => kf.title)
      .filter((title): title is string => title !== null),
  };
}

function buildSearchRequestKey(params: {
  query: string;
  filter: MetadataSearchFilter;
  genreMapping: GenreMapping | null;
  limit: number;
  locale: string | null;
  abortable: boolean;
}): string {
  const genreKey = params.genreMapping
    ? `${params.genreMapping.movieGenreId}:${params.genreMapping.tvGenreId ?? ''}`
    : '';
  return [params.query, params.filter, genreKey, String(params.limit), params.locale ?? '', params.abortable ? 'abortable' : 'shared'].join('|');
}

export function mapSearchFilterToTmdbTypes(filter: MetadataSearchFilter): TmdbTitleType[] {
  if (filter === 'movies') {
    return ['movie'];
  }
  if (filter === 'series') {
    return ['tv'];
  }
  if (filter === 'all') {
    return ['movie', 'tv'];
  }
  return [];
}

function normalizeSearchLocale(value: string | null | undefined): string | null {
  return normalizeMetadataLanguage(value);
}

function normalizeSearchFilter(filter: MetadataSearchFilter | null | undefined): MetadataSearchFilter {
  return filter === 'movies' || filter === 'series' || filter === 'people' ? filter : 'all';
}

function matchesSearchFilter(match: TmdbTitleRecord, filter: MetadataSearchFilter): boolean {
  if (filter === 'movies') {
    return match.mediaType === 'movie';
  }
  if (filter === 'series') {
    return match.mediaType === 'tv';
  }
  if (filter === 'people') {
    return false;
  }
  return match.mediaType === 'movie' || match.mediaType === 'tv';
}

function shouldQueryTmdb(filter: MetadataSearchFilter): boolean {
  return filter === 'movies' || filter === 'series' || filter === 'all';
}

function shouldSearchPeople(filter: MetadataSearchFilter): boolean {
  return filter === 'people' || filter === 'all';
}

function normalizeGenreKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function rankSearchEntries(query: string, entries: SearchBucketEntry[]): SearchBucketEntry[] {
  const seen = new Set<string>();
  return entries
    .filter(({ item }) => {
      const key = item.Id;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .map((entry) => ({
      ...entry,
      normalizedTitle: normalizeSearchText(entry.item.Name),
      normalizedSubtitle: normalizeSearchText(entry.item.OriginalTitle ?? null),
      sourcePriority: entry.item.Type === 'Movie' ? 0 : 1,
    }))
    .sort(compareSearchEntries(query))
    .map(({ normalizedTitle: _normalizedTitle, normalizedSubtitle: _normalizedSubtitle, sourcePriority: _sourcePriority, ...entry }) => entry);
}

function buildSearchBuckets(items: SearchBucketEntry[]): SearchBuckets {
  const buckets: SearchBuckets = {
    movies: [],
    series: [],
  };

  for (const entry of items) {
    if (!hasSearchPoster(entry.item)) {
      continue;
    }

    const bucket = bucketForMediaType(entry.item);
    if (bucket) {
      buckets[bucket].push(entry);
    }
  }

  return buckets;
}

function buildBucketedSearchResponse(query: string, limit: number, entries: SearchBucketEntry[], peopleEntries: MetadataPersonSearchResult[]): MetadataSearchResponse {
  const buckets = buildSearchBuckets(entries);
  const movies = finalizeBucket(query, buckets.movies, Math.min(limit, MOVIES_LIMIT));
  const series = finalizeBucket(query, buckets.series, Math.min(limit, SERIES_LIMIT));
  const all = finalizeBucket(query, [...movies, ...series], Math.min(limit * 3, ALL_LIMIT));

  return {
    query,
    all: toSearchResults(all),
    movies: toSearchResults(movies),
    series: toSearchResults(series),
    people: peopleEntries,
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

function hasSearchPoster(item: BaseItemDto): boolean {
  return Boolean(item.ImageTags.Primary?.small || item.ImageTags.Primary?.medium || item.ImageTags.Primary?.large);
}

function toSearchResults(entries: SearchBucketEntry[]): MetadataSearchResult[] {
  return entries.map(({ item }) => item);
}

function bucketForMediaType(dto: BaseItemDto): keyof SearchBuckets | null {
  if (dto.Type === 'Movie') {
    return 'movies';
  }
  if (dto.Type === 'Series') {
    return 'series';
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

    const leftYear = left.item.ProductionYear ?? Number.MIN_SAFE_INTEGER;
    const rightYear = right.item.ProductionYear ?? Number.MIN_SAFE_INTEGER;
    if (leftYear !== rightYear) {
      return rightYear - leftYear;
    }

    const leftRating = left.item.CommunityRating ?? Number.MIN_SAFE_INTEGER;
    const rightRating = right.item.CommunityRating ?? Number.MIN_SAFE_INTEGER;
    if (leftRating !== rightRating) {
      return rightRating - leftRating;
    }

    if (left.sourcePriority !== right.sourcePriority) {
      return left.sourcePriority - right.sourcePriority;
    }

    return left.item.Name.localeCompare(right.item.Name);
  };
}

function isNoisyTmdbMatch(match: TmdbTitleRecord): boolean {
  return !hasDate(match.releaseDate ?? match.firstAirDate) && !hasText(match.overview);
}

function hasDate(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

function hasText(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

function rankCatalogItem(query: string, item: { normalizedTitle: string; normalizedSubtitle: string }): number {
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

function pickBestAiMatch(query: string, matches: TmdbTitleRecord[]): TmdbTitleRecord | null {
  const normalizedQuery = normalizeForAiMatch(query);
  const queryTokens = new Set(normalizedQuery.split(' ').filter(Boolean));

  for (const match of matches) {
    const normalizedName = normalizeForAiMatch(match.name ?? '');
    const normalizedOriginal = normalizeForAiMatch(match.originalName ?? '');
    if (normalizedName === normalizedQuery || normalizedOriginal === normalizedQuery) {
      return match;
    }
  }

  const first = matches[0];
  if (!first) {
    return null;
  }

  const nameTokens = new Set(normalizeForAiMatch(first.name ?? '').split(' ').filter(Boolean));
  const hasSharedToken = [...queryTokens].some((token) => nameTokens.has(token));

  if (hasSharedToken && (first.releaseDate || first.firstAirDate)) {
    return first;
  }

  return null;
}

function normalizeForAiMatch(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
