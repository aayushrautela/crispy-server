import type { DbClient } from '../../lib/db.js';
import { withDbClient } from '../../lib/db.js';
import { ShortLivedRequestCoalescer } from '../../lib/request-coalescer.js';
import { inferMediaIdentity } from '../identity/media-key.js';
import { buildMetadataCardView } from '../metadata/metadata-card.builders.js';
import { toClientMediaCard } from '../metadata/client-media-card.mapper.js';
import type { ClientMediaCard } from '../recommendations/client-home.types.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { encodePublicItemId } from '../identity/public-item-id.js';
import { TmdbCacheService } from '../metadata/providers/tmdb-cache.service.js';
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

const MOVIES_LIMIT = 20;
const SERIES_LIMIT = 20;
const SEARCH_CACHE_TTL_MS = 3_000;
const HYDRATION_CONCURRENCY = 3;

const AI_MATCH_SEARCH_LIMIT = 10;
const AI_MATCH_MAX_SCORE = 3;
const AI_YEAR_TIEBREAK_BAND = 10;

const SCORE_EXACT = 0;
const SCORE_NEAR_EXACT = 1;
const SCORE_MAJORITY_TOKENS = 2;
const SCORE_SOME_TOKENS = 3;
const SCORE_NO_MATCH = 10;

const AI_CHAR_SIMILARITY_NEAR_EXACT = 0.65;

type SearchTitlesInternalResult = {
  tmdbMatches: TmdbTitleRecord[];
  peopleMatches: MetadataPersonSearchResult[];
  normalizedQuery: string;
  normalizedFilter: MetadataSearchFilter;
  limit: number;
  locale: string | null;
};

export class TitleSearchService {
  constructor(
    private readonly tmdbCacheService = new TmdbCacheService(),
    private readonly contentIdentityService = new ContentIdentityService(),
    private readonly requestCoalescer = new ShortLivedRequestCoalescer<SearchTitlesInternalResult>(SEARCH_CACHE_TTL_MS),
    private readonly suggestionCoalescer = new ShortLivedRequestCoalescer<SearchSuggestionItem[]>(SEARCH_CACHE_TTL_MS),
  ) {}

  async searchTitles(input: SearchTitlesInput): Promise<MetadataSearchResponse> {
    // Backward compat shim — new callers use searchTitlesInternal + route hydration.
    const internal = await this.searchTitlesInternal(input);
    if (!internal.tmdbMatches.length && !internal.peopleMatches.length) {
      return emptySearchResponse(internal.normalizedQuery);
    }
    return withDbClient(async (client) => {
      const tmdbIdentities = internal.tmdbMatches.map((match) => inferMediaIdentity({
        mediaType: match.mediaType === 'movie' ? 'movie' : 'show',
        tmdbId: match.tmdbId,
      }));
      const contentIds = await this.contentIdentityService.ensureContentIds(client, tmdbIdentities);
      const hydratedMap = await this.tmdbCacheService.getTitles(
        client,
        internal.tmdbMatches.map((m) => ({ mediaType: m.mediaType, tmdbId: m.tmdbId })),
        internal.locale,
      );
      const tmdbItems = await mapWithConcurrency(internal.tmdbMatches, HYDRATION_CONCURRENCY, async (match: TmdbTitleRecord) => {
        if (input.signal?.aborted) return null;
        const identity = inferMediaIdentity({
          mediaType: match.mediaType === 'movie' ? 'movie' : 'show',
          tmdbId: match.tmdbId,
        });
        const contentId = contentIds.get(identity.mediaKey) ?? await this.contentIdentityService.ensureContentId(client, identity).catch(() => null);
        if (!contentId) return null;
        const hydrated = hydratedMap.get(`${match.mediaType}:${match.tmdbId}`);
        if (!hydrated) return null;
        const itemId = encodePublicItemId(contentId);
        const view = buildMetadataCardView({ identity, itemId, title: hydrated, language: internal.locale });
        return { item: toClientMediaCard(view, { progress: null }), noisy: isNoisyTmdbMatch(hydrated) };
      });
      const peopleItems = internal.peopleMatches;
      return buildBucketedSearchResponse(internal.normalizedQuery, internal.limit, [
        ...tmdbItems.filter((item): item is NonNullable<(typeof tmdbItems)[number]> => item !== null),
      ], peopleItems);
    });
  }

  async searchTitlesInternal(input: SearchTitlesInput): Promise<SearchTitlesInternalResult> {
    const normalizedQuery = input.query.trim();
    const normalizedFilter = normalizeSearchFilter(input.filter);
    const genreMapping = resolveGenreMapping(input.genre);
    const limit = input.limit ?? 20;
    const locale = normalizeSearchLocale(input.locale);

    if (!normalizedQuery && !genreMapping) {
      return { tmdbMatches: [], peopleMatches: [], normalizedQuery, normalizedFilter, limit, locale };
    }

    const requestKey = buildSearchRequestKey({
      query: normalizedQuery,
      filter: normalizedFilter,
      genreMapping,
      limit,
      locale,
      abortable: Boolean(input.signal),
    });

    return this.requestCoalescer.run(requestKey, () => withDbClient(async (client) => {
      const mediaTypes = mapSearchFilterToTmdbTypes(normalizedFilter);
      const tmdbMatches = shouldQueryTmdb(normalizedFilter)
        ? genreMapping
          ? await this.tmdbCacheService.discoverTitlesByGenre(client, {
              movieGenreId: genreMapping.movieGenreId,
              tvGenreId: genreMapping.tvGenreId,
              filter: normalizedFilter,
              limit,
              locale,
            })
          : await this.tmdbCacheService.searchTitles(client, normalizedQuery, limit, mediaTypes, locale)
        : [];
      const filteredTmdbMatches = tmdbMatches.filter((match) => matchesSearchFilter(match, normalizedFilter));

      const peopleMatchesRaw = shouldSearchPeople(normalizedFilter) && normalizedQuery
        ? await this.tmdbCacheService.searchPeople(client, normalizedQuery, limit)
        : [];
      const peopleMatches = await mapWithConcurrency(peopleMatchesRaw, HYDRATION_CONCURRENCY, async (person) => buildPersonSearchResult(client, this.contentIdentityService, person));

      return {
        tmdbMatches: filteredTmdbMatches,
        peopleMatches,
        normalizedQuery,
        normalizedFilter,
        limit,
        locale,
      };
    }));
  }

  async resolveAiCandidates(input: {
    query: string;
    mediaType: 'movie' | 'tv' | null;
    year?: number | null;
    locale?: string | null;
    signal?: AbortSignal;
  }): Promise<MetadataSearchResult[]> {
    const normalizedQuery = input.query.trim();
    if (!normalizedQuery) {
      return [];
    }

    const locale = normalizeSearchLocale(input.locale);
    const mediaTypes: TmdbTitleType[] = input.mediaType ? [input.mediaType] : ['movie', 'tv'];

    return withDbClient(async (client) => {
      let rawMatches = await this.tmdbCacheService.searchTitles(client, normalizedQuery, AI_MATCH_SEARCH_LIMIT, mediaTypes, locale);

      if (rawMatches.length === 0 && input.mediaType) {
        rawMatches = await this.tmdbCacheService.searchTitles(client, normalizedQuery, AI_MATCH_SEARCH_LIMIT, ['movie', 'tv'], locale);
      }

      if (rawMatches.length === 0) {
        return [];
      }

      const ranked = rankAiMatches(normalizedQuery, rawMatches);
      const winner = selectAiMatchWinner(ranked, input.year ?? null);
      if (!winner) {
        return [];
      }

      const results: MetadataSearchResult[] = [];
      const matches = [winner];
      for (const { match } of matches) {
        if (input.signal?.aborted) {
          break;
        }

        const identity = inferMediaIdentity({
          mediaType: match.mediaType === 'movie' ? 'movie' : 'show',
          tmdbId: match.tmdbId,
        });
        const contentId = await this.contentIdentityService.ensureContentId(client, identity).catch(() => null);
        if (!contentId) {
          continue;
        }

        const hydrated = await this.tmdbCacheService.getTitle(client, match.mediaType, match.tmdbId, locale);
        if (!hydrated) {
          continue;
        }

        const itemId = encodePublicItemId(contentId);
        const view = buildMetadataCardView({ identity, itemId, title: hydrated, language: locale });
        results.push(toClientMediaCard(view, { progress: null }));
      }

      return results;
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
    knownForTitles: (person.knownFor ?? [])
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
  const movies = finalizeBucket(buckets.movies, Math.min(limit, MOVIES_LIMIT));
  const series = finalizeBucket(buckets.series, Math.min(limit, SERIES_LIMIT));

  return {
    query,
    movies: toSearchResults(movies),
    series: toSearchResults(series),
    people: peopleEntries,
  };
}

function finalizeBucket(items: SearchBucketEntry[], limit: number): SearchBucketEntry[] {
  return moveNoisyItemsToEnd(items).slice(0, limit);
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

function hasSearchPoster(item: ClientMediaCard): boolean {
  const poster = item.images.poster;
  return Boolean(poster && (poster.small || poster.medium || poster.large));
}

function toSearchResults(entries: SearchBucketEntry[]): MetadataSearchResult[] {
  return entries.map(({ item }) => item);
}

function bucketForMediaType(card: ClientMediaCard): keyof SearchBuckets | null {
  if (card.mediaType === 'movie') {
    return 'movies';
  }
  if (card.mediaType === 'tv') {
    return 'series';
  }
  return null;
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

export type RankedAiMatch = {
  match: TmdbTitleRecord;
  score: number;
};

export function rankAiMatches(query: string, matches: TmdbTitleRecord[]): RankedAiMatch[] {
  const normalizedQuery = normalizeForAiMatch(query);
  return matches
    .map((match) => ({ match, score: scoreAiMatch(normalizedQuery, match) }))
    .sort((left, right) => compareRankedAiMatches(left, right, null));
}

export function selectAiMatchWinner(ranked: RankedAiMatch[], queryYear: number | null): RankedAiMatch | null {
  if (ranked.length === 0) {
    return null;
  }

  const sorted = ranked.slice().sort((left, right) => compareRankedAiMatches(left, right, queryYear));

  if (sorted[0]?.score === SCORE_EXACT) {
    return sorted[0] ?? null;
  }

  if (sorted[0] && sorted[0].score <= AI_MATCH_MAX_SCORE) {
    return sorted[0];
  }
  return null;
}

function compareRankedAiMatches(left: RankedAiMatch, right: RankedAiMatch, queryYear: number | null): number {
  if (left.score !== right.score) {
    return left.score - right.score;
  }
  if (queryYear != null) {
    const leftByYear = compareMatchToYear(left.match, queryYear);
    const rightByYear = compareMatchToYear(right.match, queryYear);
    if (leftByYear !== rightByYear) {
      return leftByYear - rightByYear;
    }
  }
  return compareTitleRecordFreshness(left.match, right.match);
}

function compareMatchToYear(match: TmdbTitleRecord, queryYear: number): number {
  const year = titleYear(match);
  if (year === null) {
    return Number.MAX_SAFE_INTEGER;
  }
  return Math.abs(year - queryYear) <= AI_YEAR_TIEBREAK_BAND
    ? Math.abs(year - queryYear)
    : Number.MAX_SAFE_INTEGER;
}

export function titleYear(match: TmdbTitleRecord): number | null {
  const date = match.releaseDate ?? match.firstAirDate ?? null;
  if (!date) {
    return null;
  }
  const year = Number.parseInt(date.slice(0, 4), 10);
  return Number.isInteger(year) && year > 0 ? year : null;
}

function compareTitleRecordFreshness(left: TmdbTitleRecord, right: TmdbTitleRecord): number {
  const leftDate = left.releaseDate ?? left.firstAirDate ?? null;
  const rightDate = right.releaseDate ?? right.firstAirDate ?? null;
  const leftHasDate = Boolean(leftDate?.trim());
  const rightHasDate = Boolean(rightDate?.trim());
  if (leftHasDate !== rightHasDate) {
    return leftHasDate ? -1 : 1;
  }
  if (!leftHasDate || !rightDate || !leftDate) {
    return left.tmdbId - right.tmdbId;
  }
  return rightDate.localeCompare(leftDate);
}

export function scoreAiMatch(normalizedQuery: string, match: TmdbTitleRecord): number {
  const normalizedName = normalizeForAiMatch(match.name ?? '');
  const normalizedOriginal = normalizeForAiMatch(match.originalName ?? '');

  if (normalizedName === normalizedQuery || normalizedOriginal === normalizedQuery) {
    return SCORE_EXACT;
  }

  const queryTokens = normalizedQuery.split(' ').filter(Boolean);

  const nameTokenScore = tokenOverlapScore(queryTokens, normalizedName);
  const originalTokenScore = tokenOverlapScore(queryTokens, normalizedOriginal);
  const tokenScore = Math.min(nameTokenScore, originalTokenScore);

  const nameSimilarity = characterSimilarity(normalizedQuery, normalizedName);
  const originalSimilarity = characterSimilarity(normalizedQuery, normalizedOriginal);
  const bestSimilarity = Math.max(nameSimilarity, originalSimilarity);

  if (bestSimilarity >= AI_CHAR_SIMILARITY_NEAR_EXACT) {
    return SCORE_NEAR_EXACT;
  }

  return tokenScore;
}

export function tokenOverlapScore(queryTokens: string[], candidateText: string): number {
  if (queryTokens.length === 0) {
    return SCORE_NO_MATCH;
  }
  const candidateTokens = candidateText.split(' ').filter(Boolean);
  if (candidateTokens.length === 0) {
    return SCORE_NO_MATCH;
  }

  const candidateSet = new Set(candidateTokens);
  let shared = 0;
  for (const token of queryTokens) {
    if (candidateSet.has(token)) {
      shared += 1;
    }
  }

  if (shared === 0) {
    return SCORE_NO_MATCH;
  }
  if (shared === queryTokens.length) {
    return SCORE_NEAR_EXACT;
  }
  if (shared / queryTokens.length >= 0.5) {
    return SCORE_MAJORITY_TOKENS;
  }
  return SCORE_SOME_TOKENS;
}

export function characterSimilarity(a: string, b: string): number {
  if (!a || !b) {
    return 0;
  }
  if (a === b) {
    return 1;
  }

  const bigramsA = characterBigrams(a);
  const bigramsB = characterBigrams(b);
  if (bigramsA.size === 0 || bigramsB.size === 0) {
    return 0;
  }

  let shared = 0;
  for (const bigram of bigramsA) {
    if (bigramsB.has(bigram)) {
      shared += 1;
    }
  }

  return shared / Math.max(bigramsA.size, bigramsB.size);
}

function characterBigrams(value: string): Set<string> {
  const bigrams = new Set<string>();
  for (let index = 0; index < value.length - 1; index += 1) {
    bigrams.add(value.slice(index, index + 2));
  }
  return bigrams;
}

function normalizeForAiMatch(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
