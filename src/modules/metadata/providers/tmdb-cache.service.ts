import { appConfig } from '../../../config/app-config.js';
import type { DbClient } from '../../../lib/db.js';
import { HttpError } from '../../../lib/errors.js';
import { buildTmdbIncludeImageLanguage, normalizeMetadataLanguage, toTmdbLanguageQuery } from '../metadata-language.js';
import { TmdbClient } from './tmdb.client.js';
import { TmdbRepository } from './tmdb.repo.js';
import { TmdbResponseCacheService } from './tmdb-response-cache.service.js';
import type { MetadataSearchFilter, SearchSuggestionItem } from '../metadata-detail.types.js';
import type { TmdbEpisodeRecord, TmdbPersonRecord, TmdbSeasonRecord, TmdbTitleRecord, TmdbTitleType } from './tmdb.types.js';

type PersonSearchPayloadItem = {
  id?: unknown;
  name?: unknown;
  known_for_department?: unknown;
  profile_path?: unknown;
  known_for?: unknown[];
  popularity?: unknown;
};

type SearchPayloadItem = {
  id?: unknown;
  title?: unknown;
  name?: unknown;
  original_title?: unknown;
  original_name?: unknown;
  overview?: unknown;
  release_date?: unknown;
  first_air_date?: unknown;
  poster_path?: unknown;
  backdrop_path?: unknown;
  status?: unknown;
  tagline?: unknown;
};

function searchRank(query: string, candidate: string | null): number {
  if (!candidate) {
    return 4;
  }

  const normalizedQuery = query.trim().toLowerCase();
  const normalizedCandidate = candidate.trim().toLowerCase();
  if (!normalizedQuery || !normalizedCandidate) {
    return 4;
  }
  if (normalizedCandidate === normalizedQuery) {
    return 0;
  }
  if (normalizedCandidate.startsWith(normalizedQuery)) {
    return 1;
  }
  if (normalizedCandidate.includes(normalizedQuery)) {
    return 2;
  }
  return 3;
}

function searchPopularity(item: SearchPayloadItem): number {
  const value = item && typeof item === 'object' ? (item as Record<string, unknown>).popularity : null;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function toSearchTitleRecord(mediaType: TmdbTitleType, item: SearchPayloadItem, language?: string): TmdbTitleRecord | null {
  const tmdbId = typeof item?.id === 'number' ? item.id : null;
  if (!tmdbId) {
    return null;
  }

  const now = new Date().toISOString();
  const effectiveLanguage = normalizeMetadataLanguage(language) ?? 'en';
  return {
    mediaType,
    tmdbId,
    language: effectiveLanguage,
    name: toNullableString(item.title) ?? toNullableString(item.name),
    originalName: toNullableString(item.original_title) ?? toNullableString(item.original_name),
    overview: toNullableString(item.overview),
    tagline: toNullableString(item.tagline),
    releaseDate: toNullableString(item.release_date),
    firstAirDate: toNullableString(item.first_air_date),
    status: toNullableString(item.status),
    posterPath: toNullableString(item.poster_path),
    backdropPath: toNullableString(item.backdrop_path),
    runtime: null,
    episodeRunTime: [],
    numberOfSeasons: null,
    numberOfEpisodes: null,
    externalIds: {},
    raw: item as Record<string, unknown>,
    fetchedAt: now,
    expiresAt: now,
  };
}

function dedupeTitles(records: TmdbTitleRecord[]): TmdbTitleRecord[] {
  const seen = new Set<string>();
  const deduped: TmdbTitleRecord[] = [];
  for (const record of records) {
    const key = `${record.mediaType}:${record.tmdbId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(record);
  }
  return deduped;
}

function sortSearchResults(query: string, records: TmdbTitleRecord[]): TmdbTitleRecord[] {
  return [...records].sort((left, right) => {
    const leftRank = Math.min(searchRank(query, left.name), searchRank(query, left.originalName));
    const rightRank = Math.min(searchRank(query, right.name), searchRank(query, right.originalName));
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    return searchPopularity(right.raw as SearchPayloadItem) - searchPopularity(left.raw as SearchPayloadItem);
  });
}

function sortDiscoverResults(records: TmdbTitleRecord[]): TmdbTitleRecord[] {
  return [...records].sort((left, right) => {
    return searchPopularity(right.raw as SearchPayloadItem) - searchPopularity(left.raw as SearchPayloadItem);
  });
}

function toSearchPersonRecord(item: PersonSearchPayloadItem): TmdbPersonRecord | null {
  const tmdbPersonId = typeof item?.id === 'number' ? item.id : null;
  if (!tmdbPersonId) {
    return null;
  }

  const knownFor = Array.isArray(item.known_for)
    ? item.known_for.map((kf) => {
        const entry = kf as Record<string, unknown>;
        return {
          mediaType: typeof entry.media_type === 'string' ? entry.media_type : 'movie',
          title: toNullableString(entry.title) ?? toNullableString(entry.name),
          tmdbId: typeof entry.id === 'number' ? entry.id : 0,
        };
      }).filter((kf) => kf.title)
    : [];

  return {
    tmdbPersonId,
    name: toNullableString(item.name) ?? '',
    knownForDepartment: toNullableString(item.known_for_department),
    profilePath: toNullableString(item.profile_path),
    knownFor,
    popularity: typeof item.popularity === 'number' ? item.popularity : 0,
  };
}

function toNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function toNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toNoLanguagePosterPath(title: Record<string, unknown>): string | null {
  const images = title.images;
  if (typeof images !== 'object' || images === null || !Array.isArray((images as Record<string, unknown>).posters)) {
    return null;
  }

  const poster = ((images as Record<string, unknown>).posters as unknown[])
    .map((entry) => (typeof entry === 'object' && entry !== null ? entry as Record<string, unknown> : null))
    .find((entry) => entry?.iso_639_1 === null);

  return poster ? toNullableString(poster.file_path) : null;
}

function toBestNoLanguageBackdropPath(title: Record<string, unknown>): string | null {
  const images = title.images;
  if (typeof images !== 'object' || images === null || !Array.isArray((images as Record<string, unknown>).backdrops)) {
    return null;
  }

  const candidates = ((images as Record<string, unknown>).backdrops as unknown[])
    .map((entry) => (typeof entry === 'object' && entry !== null ? entry as Record<string, unknown> : null))
    .filter((entry): entry is Record<string, unknown> => entry !== null && entry.iso_639_1 === null)
    .map((entry) => ({
      filePath: toNullableString(entry.file_path),
      voteAverage: typeof entry.vote_average === 'number' && Number.isFinite(entry.vote_average) ? entry.vote_average : 0,
      voteCount: typeof entry.vote_count === 'number' && Number.isFinite(entry.vote_count) ? entry.vote_count : 0,
    }))
    .filter((entry): entry is { filePath: string; voteAverage: number; voteCount: number } => entry.filePath !== null);

  if (candidates.length === 0) {
    return null;
  }

  const minVotes = 5;
  const meanAverage = candidates.reduce((sum, entry) => sum + entry.voteAverage, 0) / candidates.length;
  let best = candidates[0];
  if (best === undefined) {
    return null;
  }
  let bestScore = (meanAverage * minVotes + best.voteCount * best.voteAverage) / (best.voteCount + minVotes);

  for (let index = 1; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (candidate === undefined) {
      break;
    }
    const score = (meanAverage * minVotes + candidate.voteCount * candidate.voteAverage) / (candidate.voteCount + minVotes);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best.filePath;
}

export class TmdbCacheService {
  constructor(
    private readonly tmdbRepository = new TmdbRepository(),
    private readonly tmdbClient = new TmdbClient(),
    private readonly responseCache = new TmdbResponseCacheService(),
  ) {}

  async getTitle(client: DbClient, mediaType: TmdbTitleType, tmdbId: number, language?: string | null, signal?: AbortSignal): Promise<TmdbTitleRecord | null> {
    const effectiveLanguage = normalizeMetadataLanguage(language) ?? 'en';
    const cached = await this.tmdbRepository.getTitle(client, mediaType, tmdbId, effectiveLanguage);
    if (cached && Date.parse(cached.expiresAt) > Date.now()) {
      return cached;
    }

    const policyKey = mediaType === 'movie' ? 'title:movie' : 'title:tv';
    const appendToResponse = mediaType === 'movie'
      ? 'images,release_dates,videos,credits,external_ids'
      : 'images,content_ratings,videos,credits,external_ids';
    const includeImageLanguage = buildTmdbIncludeImageLanguage(effectiveLanguage);

    const response = await this.responseCache.getOrFetch(
      client,
      {
        resourceType: 'title',
        resourceId: `${mediaType}:${tmdbId}`,
        variant: 'detail',
        language: effectiveLanguage,
        requestPath: `/${mediaType}/${tmdbId}`,
        requestQuery: { append_to_response: appendToResponse, include_image_language: includeImageLanguage, language: toTmdbLanguageQuery(effectiveLanguage) },
      },
      policyKey,
      () => this.tmdbClient.request(`/${mediaType}/${tmdbId}`, { append_to_response: appendToResponse, include_image_language: includeImageLanguage, language: toTmdbLanguageQuery(effectiveLanguage) }, signal),
    );

    if (response.isNegative || response.statusCode === 404) {
      return null;
    }

    const title = response.responseJson;
    const now = new Date().toISOString();
    const ttlHours = mediaType === 'movie' ? appConfig.cache.tmdb.movieTtlHours : appConfig.cache.tmdb.showTtlHours;
    const record: TmdbTitleRecord = {
      mediaType,
      tmdbId,
      language: effectiveLanguage,
      name: toNullableString(title.title) ?? toNullableString(title.name),
      originalName: toNullableString(title.original_title) ?? toNullableString(title.original_name),
      overview: toNullableString(title.overview),
      tagline: toNullableString(title.tagline),
      releaseDate: toNullableString(title.release_date),
      firstAirDate: toNullableString(title.first_air_date),
      status: toNullableString(title.status),
      posterPath: toNoLanguagePosterPath(title) ?? toNullableString(title.poster_path),
      backdropPath: toBestNoLanguageBackdropPath(title) ?? toNullableString(title.backdrop_path),
      runtime: toNullableNumber(title.runtime),
      episodeRunTime: Array.isArray(title.episode_run_time) ? title.episode_run_time.map((value) => Number(value)) : [],
      numberOfSeasons: toNullableNumber(title.number_of_seasons),
      numberOfEpisodes: toNullableNumber(title.number_of_episodes),
      externalIds: (title.external_ids as Record<string, unknown> | undefined) ?? {},
      raw: title,
      fetchedAt: now,
      expiresAt: new Date(Date.parse(now) + ttlHours * 60 * 60 * 1000).toISOString(),
    };

    await this.tmdbRepository.upsertTitle(client, record);
    return record;
  }

  async getCollection(client: DbClient, collectionId: number, language?: string | null): Promise<Record<string, unknown> | null> {
    const effectiveLanguage = normalizeMetadataLanguage(language) ?? 'en';
    const response = await this.responseCache.getOrFetch(
      client,
      {
        resourceType: 'collection',
        resourceId: String(collectionId),
        variant: 'detail',
        language: effectiveLanguage,
        requestPath: `/collection/${collectionId}`,
        requestQuery: { language: toTmdbLanguageQuery(effectiveLanguage) },
      },
      'collection',
      () => this.tmdbClient.request(`/collection/${collectionId}`, { language: toTmdbLanguageQuery(effectiveLanguage) }),
    );

    if (response.isNegative || response.statusCode === 404) {
      return null;
    }

    return response.responseJson;
  }

  async refreshSeason(client: DbClient, showTmdbId: number, seasonNumber: number): Promise<void> {
    const response = await this.responseCache.getOrFetch(
      client,
      {
        resourceType: 'season',
        resourceId: `${showTmdbId}:${seasonNumber}`,
        variant: 'detail',
        language: null,
        requestPath: `/tv/${showTmdbId}/season/${seasonNumber}`,
        requestQuery: {},
      },
      'season',
      () => this.tmdbClient.request(`/tv/${showTmdbId}/season/${seasonNumber}`),
    );

    if (response.isNegative || response.statusCode === 404) {
      throw new HttpError(404, `Season ${seasonNumber} not found for show ${showTmdbId}`);
    }

    const season = response.responseJson;
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.parse(now) + appConfig.cache.tmdb.seasonTtlHours * 60 * 60 * 1000).toISOString();
    const episodes: TmdbEpisodeRecord[] = Array.isArray(season.episodes)
      ? season.episodes.map((episode) => ({
          showTmdbId,
          seasonNumber,
          episodeNumber: Number(episode.episode_number),
          tmdbId: toNullableNumber(episode.id),
          name: toNullableString(episode.name),
          overview: toNullableString(episode.overview),
          airDate: toNullableString(episode.air_date),
          runtime: toNullableNumber(episode.runtime),
          stillPath: toNullableString(episode.still_path),
          voteAverage: toNullableNumber(episode.vote_average),
          raw: episode as Record<string, unknown>,
          fetchedAt: now,
          expiresAt,
        }))
      : [];

    await this.tmdbRepository.replaceSeasonEpisodes(client, {
      showTmdbId,
      seasonNumber,
      seasonName: toNullableString(season.name),
      seasonOverview: toNullableString(season.overview),
      airDate: toNullableString(season.air_date),
      posterPath: toNullableString(season.poster_path),
      episodeCount: toNullableNumber(season.episode_count),
      raw: season,
      episodes,
      fetchedAt: now,
      expiresAt,
    });
  }

  async getSeason(client: DbClient, showTmdbId: number, seasonNumber: number): Promise<TmdbSeasonRecord | null> {
    return this.tmdbRepository.getSeason(client, showTmdbId, seasonNumber);
  }

  async getEpisode(client: DbClient, showTmdbId: number, seasonNumber: number, episodeNumber: number): Promise<TmdbEpisodeRecord | null> {
    return this.tmdbRepository.getEpisode(client, showTmdbId, seasonNumber, episodeNumber);
  }

  async getEpisodes(client: DbClient, requests: Array<{ showTmdbId: number; seasonNumber: number; episodeNumber: number }>): Promise<Map<string, TmdbEpisodeRecord | null>> {
    const records = requests.length ? await this.tmdbRepository.getEpisodes(client, requests) : new Map<string, TmdbEpisodeRecord>();
    const result = new Map<string, TmdbEpisodeRecord | null>();
    for (const req of requests) {
      const key = `${req.showTmdbId}:${req.seasonNumber}:${req.episodeNumber}`;
      result.set(key, records.get(key) ?? null);
    }
    return result;
  }

  async ensureSeasonCached(client: DbClient, showTmdbId: number, seasonNumber: number): Promise<TmdbSeasonRecord | null> {
    const cached = await this.tmdbRepository.getSeason(client, showTmdbId, seasonNumber);
    if (cached && Date.parse(cached.expiresAt) > Date.now()) {
      return cached;
    }

    try {
      await this.refreshSeason(client, showTmdbId, seasonNumber);
      return this.tmdbRepository.getSeason(client, showTmdbId, seasonNumber);
    } catch (error) {
      if (cached) {
        return cached;
      }
      throw error;
    }
  }

  async fetchTitleExtrasPayload(client: DbClient, mediaType: TmdbTitleType, tmdbId: number, language?: string | null): Promise<Record<string, unknown> | null> {
    const effectiveLanguage = normalizeMetadataLanguage(language) ?? 'en';
    const appendToResponse = 'reviews,recommendations';
    const includeImageLanguage = buildTmdbIncludeImageLanguage(effectiveLanguage);
    const response = await this.responseCache.getOrFetch(
      client,
      {
        resourceType: 'title',
        resourceId: `${mediaType}:${tmdbId}`,
        variant: 'extras',
        language: effectiveLanguage,
        requestPath: `/${mediaType}/${tmdbId}`,
        requestQuery: { append_to_response: appendToResponse, include_image_language: includeImageLanguage, language: toTmdbLanguageQuery(effectiveLanguage) },
      },
      mediaType === 'movie' ? 'title:movie' : 'title:tv',
      () => this.tmdbClient.request(`/${mediaType}/${tmdbId}`, { append_to_response: appendToResponse, include_image_language: includeImageLanguage, language: toTmdbLanguageQuery(effectiveLanguage) }),
    );

    if (response.isNegative || response.statusCode === 404) {
      return null;
    }

    return response.responseJson;
  }

  async getTitles(client: DbClient, requests: Array<{ mediaType: TmdbTitleType; tmdbId: number }>, language?: string | null, signal?: AbortSignal): Promise<Map<string, TmdbTitleRecord | null>> {
    const effectiveLanguage = normalizeMetadataLanguage(language) ?? 'en';
    const cached = await this.tmdbRepository.getTitles(client, requests, effectiveLanguage);

    const results = new Map<string, TmdbTitleRecord | null>();
    const missing: Array<{ mediaType: TmdbTitleType; tmdbId: number }> = [];

    for (const req of requests) {
      const key = `${req.mediaType}:${req.tmdbId}`;
      const record = cached.get(key);
      if (record && Date.parse(record.expiresAt) > Date.now()) {
        results.set(key, record);
      } else {
        missing.push(req);
      }
    }

    await Promise.all(missing.map(async (req) => {
      const key = `${req.mediaType}:${req.tmdbId}`;
      const hydrated = await this.getTitle(client, req.mediaType, req.tmdbId, effectiveLanguage, signal);
      results.set(key, hydrated);
    }));

    return results;
  }

  async listEpisodesForShow(client: DbClient, showTmdbId: number): Promise<TmdbEpisodeRecord[]> {
    return this.tmdbRepository.listEpisodesForShow(client, showTmdbId);
  }

  async listEpisodesForSeason(client: DbClient, showTmdbId: number, seasonNumber: number): Promise<TmdbEpisodeRecord[]> {
    return this.tmdbRepository.listEpisodesForSeason(client, showTmdbId, seasonNumber);
  }

  async searchTitles(client: DbClient, query: string, limit: number, mediaTypes: TmdbTitleType[], locale?: string | null, signal?: AbortSignal): Promise<TmdbTitleRecord[]> {
    const payloads = await Promise.all(
      mediaTypes.map((mediaType) =>
        this.responseCache.getOrFetch(
          client,
          {
            resourceType: 'search',
            resourceId: null,
            variant: 'title',
            language: normalizeMetadataLanguage(locale),
            requestPath: `/search/${mediaType}`,
            requestQuery: { query, page: 1, include_adult: 'false', language: toTmdbLanguageQuery(normalizeMetadataLanguage(locale)) },
          },
          'search',
          () => this.tmdbClient.request(`/search/${mediaType}`, { query, page: 1, include_adult: 'false', language: toTmdbLanguageQuery(normalizeMetadataLanguage(locale)) }, signal),
        ),
      ),
    );

    const records = payloads.flatMap((response, index) => {
      if (response.isNegative || response.statusCode === 404) {
        return [];
      }
      const mediaType = mediaTypes[index] as TmdbTitleType;
      const items = Array.isArray(response.responseJson.results) ? response.responseJson.results as SearchPayloadItem[] : [];
      return items
        .map((item) => toSearchTitleRecord(mediaType, item, normalizeMetadataLanguage(locale) ?? undefined))
        .filter((item): item is TmdbTitleRecord => item !== null);
    });

    return sortSearchResults(query, dedupeTitles(records)).slice(0, limit);
  }

  async searchPeople(client: DbClient, query: string, limit: number): Promise<TmdbPersonRecord[]> {
    const response = await this.responseCache.getOrFetch(
      client,
      {
        resourceType: 'search',
        resourceId: null,
        variant: 'person',
        language: null,
        requestPath: '/search/person',
        requestQuery: { query, page: 1, include_adult: 'false' },
      },
      'search',
      () => this.tmdbClient.request('/search/person', { query, page: 1, include_adult: 'false' }),
    );

    if (response.isNegative || response.statusCode === 404) {
      return [];
    }

    const items = Array.isArray(response.responseJson.results) ? response.responseJson.results as PersonSearchPayloadItem[] : [];
    const records = items
      .map((item) => toSearchPersonRecord(item))
      .filter((item): item is TmdbPersonRecord => item !== null);
    return records.slice(0, limit);
  }

  async searchSuggestions(client: DbClient, query: string, limit: number, filter: MetadataSearchFilter, locale?: string | null): Promise<SearchSuggestionItem[]> {
    const normalizedLocale = normalizeMetadataLanguage(locale) ?? undefined;

    const response = await this.responseCache.getOrFetch(
      client,
      {
        resourceType: 'search',
        resourceId: null,
        variant: 'suggestion',
        language: normalizedLocale ?? null,
        requestPath: '/search/multi',
        requestQuery: { query, page: 1, include_adult: 'false', language: toTmdbLanguageQuery(normalizedLocale ?? null) },
      },
      'search',
      () => this.tmdbClient.request('/search/multi', { query, page: 1, include_adult: 'false', language: toTmdbLanguageQuery(normalizedLocale ?? null) }),
    );

    if (response.isNegative || response.statusCode === 404) {
      return [];
    }

    type MultiSearchItem = {
      id?: unknown;
      media_type?: unknown;
      title?: unknown;
      name?: unknown;
      release_date?: unknown;
      first_air_date?: unknown;
      poster_path?: unknown;
      overview?: unknown;
      popularity?: unknown;
    };

    const results = Array.isArray(response.responseJson.results) ? response.responseJson.results as MultiSearchItem[] : [];
    const suggestions: SearchSuggestionItem[] = [];

    for (const item of results) {
      const mediaType = item.media_type;
      if (mediaType !== 'movie' && mediaType !== 'tv') {
        continue;
      }
      if (filter === 'movies' && mediaType !== 'movie') continue;
      if (filter === 'series' && mediaType !== 'tv') continue;
      if (filter === 'people') continue;

      const tmdbId = typeof item.id === 'number' ? item.id : null;
      if (!tmdbId) continue;

      const title = toNullableString(item.title) ?? toNullableString(item.name) ?? '';
      if (!title) continue;

      const dateStr = mediaType === 'movie'
        ? toNullableString(item.release_date)
        : toNullableString(item.first_air_date);
      const year = dateStr ? new Date(dateStr).getFullYear() : null;

      const posterPath = toNullableString(item.poster_path);
      const primary = posterPath ? {
        small: `https://image.tmdb.org/t/p/w185${posterPath}`,
        medium: `https://image.tmdb.org/t/p/w342${posterPath}`,
        large: `https://image.tmdb.org/t/p/w500${posterPath}`,
      } : null;

      suggestions.push({
        Id: String(tmdbId),
        Type: mediaType === 'movie' ? 'Movie' : 'Series',
        Name: title,
        ProductionYear: year,
        ImageTags: primary ? { Primary: primary } : null,
        ProviderIds: { Tmdb: String(tmdbId) },
      });
    }

    suggestions.sort((a, b) => (b.ProductionYear ?? 0) - (a.ProductionYear ?? 0));
    return suggestions.slice(0, limit);
  }

  async discoverTitlesByGenre(client: DbClient, params: {
      movieGenreId?: number | null;
      tvGenreId?: number | null;
      filter: MetadataSearchFilter;
      limit: number;
    }): Promise<TmdbTitleRecord[]> {
    const requestedTypes: Array<{ mediaType: TmdbTitleType; genreId: number }> = [];
    if ((params.filter === 'movies' || params.filter === 'all') && params.movieGenreId) {
      requestedTypes.push({ mediaType: 'movie', genreId: params.movieGenreId });
    }
    if ((params.filter === 'series' || params.filter === 'all') && params.tvGenreId) {
      requestedTypes.push({ mediaType: 'tv', genreId: params.tvGenreId });
    }

    const payloads = await Promise.all(
      requestedTypes.map(({ mediaType, genreId }) =>
        this.responseCache.getOrFetch(
          client,
          {
            resourceType: 'discover',
            resourceId: null,
            variant: 'genre',
            language: null,
            requestPath: `/discover/${mediaType}`,
            requestQuery: { with_genres: genreId, page: 1, sort_by: 'popularity.desc', include_adult: 'false' },
          },
          'search',
          () => this.tmdbClient.request(`/discover/${mediaType}`, { with_genres: genreId, page: 1, sort_by: 'popularity.desc', include_adult: 'false' }),
        ),
      ),
    );

    const records = payloads.flatMap((response, index) => {
      if (response.isNegative || response.statusCode === 404) {
        return [];
      }
      const mediaType = requestedTypes[index]?.mediaType;
      if (!mediaType) {
        return [];
      }
      const items = Array.isArray(response.responseJson.results) ? response.responseJson.results as SearchPayloadItem[] : [];
      return items
        .map((item) => toSearchTitleRecord(mediaType, item))
        .filter((item): item is TmdbTitleRecord => item !== null);
    });

    return sortDiscoverResults(dedupeTitles(records)).slice(0, params.limit);
  }

  /**
   * Generic list endpoint helper (trending/popular/top_rated/now_playing/etc).
   * Reads `results` from the TMDB paged response and maps each to a record.
   */
  private async fetchListEndpoint(
    client: DbClient,
    resourceType: string,
    requestPath: string,
    requestQuery: Record<string, string | number | undefined>,
    mediaType: TmdbTitleType,
    limit: number,
  ): Promise<TmdbTitleRecord[]> {
    const response = await this.responseCache.getOrFetch(
      client,
      {
        resourceType,
        resourceId: null,
        variant: requestPath.replace(/[^a-z0-9]/gi, '_'),
        language: requestQuery.language as string | null ?? null,
        requestPath,
        requestQuery,
      },
      'search',
      () => this.tmdbClient.request(requestPath, requestQuery),
    );
    if (response.isNegative || response.statusCode === 404) {
      return [];
    }
    const items = Array.isArray(response.responseJson.results) ? (response.responseJson.results as SearchPayloadItem[]) : [];
    return items
      .map((item) => toSearchTitleRecord(mediaType, item, requestQuery.language as string | undefined))
      .filter((item): item is TmdbTitleRecord => item !== null)
      .slice(0, limit);
  }

  async fetchTrending(
    client: DbClient,
    mediaType: TmdbTitleType,
    timeWindow: 'day' | 'week',
    opts: { page?: number; language?: string; region?: string; limit?: number } = {},
  ): Promise<TmdbTitleRecord[]> {
    const limit = Math.min(opts.limit ?? 20, 100);
    const requestQuery: Record<string, string | number | undefined> = { page: opts.page ?? 1, include_adult: 'false' };
    if (opts.language) requestQuery.language = opts.language;
    if (opts.region) requestQuery.region = opts.region;
    return this.fetchListEndpoint(client, 'trending', `/trending/${mediaType}/${timeWindow}`, requestQuery, mediaType, limit);
  }

  async fetchPopular(
    client: DbClient,
    mediaType: TmdbTitleType,
    opts: { page?: number; language?: string; region?: string; limit?: number } = {},
  ): Promise<TmdbTitleRecord[]> {
    const limit = Math.min(opts.limit ?? 20, 100);
    const requestQuery: Record<string, string | number | undefined> = { page: opts.page ?? 1, include_adult: 'false' };
    if (opts.language) requestQuery.language = opts.language;
    if (opts.region) requestQuery.region = opts.region;
    return this.fetchListEndpoint(client, 'popular', `/${mediaType}/popular`, requestQuery, mediaType, limit);
  }

  async fetchTopRated(
    client: DbClient,
    mediaType: TmdbTitleType,
    opts: { page?: number; language?: string; region?: string; limit?: number } = {},
  ): Promise<TmdbTitleRecord[]> {
    const limit = Math.min(opts.limit ?? 20, 100);
    const requestQuery: Record<string, string | number | undefined> = { page: opts.page ?? 1, include_adult: 'false' };
    if (opts.language) requestQuery.language = opts.language;
    if (opts.region) requestQuery.region = opts.region;
    return this.fetchListEndpoint(client, 'top_rated', `/${mediaType}/top_rated`, requestQuery, mediaType, limit);
  }

  async fetchNowPlaying(
    client: DbClient,
    opts: { page?: number; language?: string; region?: string; limit?: number } = {},
  ): Promise<TmdbTitleRecord[]> {
    const limit = Math.min(opts.limit ?? 20, 100);
    const requestQuery: Record<string, string | number | undefined> = { page: opts.page ?? 1, include_adult: 'false' };
    if (opts.language) requestQuery.language = opts.language;
    if (opts.region) requestQuery.region = opts.region;
    return this.fetchListEndpoint(client, 'now_playing', '/movie/now_playing', requestQuery, 'movie', limit);
  }

  async fetchAiringToday(
    client: DbClient,
    opts: { page?: number; language?: string; region?: string; limit?: number } = {},
  ): Promise<TmdbTitleRecord[]> {
    const limit = Math.min(opts.limit ?? 20, 100);
    const requestQuery: Record<string, string | number | undefined> = { page: opts.page ?? 1, include_adult: 'false' };
    if (opts.language) requestQuery.language = opts.language;
    if (opts.region) requestQuery.region = opts.region;
    return this.fetchListEndpoint(client, 'airing_today', '/tv/airing_today', requestQuery, 'tv', limit);
  }

  async fetchUpcoming(
    client: DbClient,
    opts: { page?: number; language?: string; region?: string; limit?: number } = {},
  ): Promise<TmdbTitleRecord[]> {
    const limit = Math.min(opts.limit ?? 20, 100);
    const requestQuery: Record<string, string | number | undefined> = { page: opts.page ?? 1, include_adult: 'false' };
    if (opts.language) requestQuery.language = opts.language;
    if (opts.region) requestQuery.region = opts.region;
    return this.fetchListEndpoint(client, 'upcoming', '/movie/upcoming', requestQuery, 'movie', limit);
  }

  async fetchTmdbList(
    client: DbClient,
    listId: number,
    opts: { language?: string; limit?: number } = {},
  ): Promise<TmdbTitleRecord[]> {
    const limit = Math.min(opts.limit ?? 20, 100);
    const requestQuery: Record<string, string | number | undefined> = { page: 1 };
    if (opts.language) requestQuery.language = opts.language;
    const response = await this.responseCache.getOrFetch(
      client,
      {
        resourceType: 'list',
        resourceId: String(listId),
        variant: 'items',
        language: opts.language ?? null,
        requestPath: `/list/${listId}`,
        requestQuery,
      },
      'search',
      () => this.tmdbClient.request(`/list/${listId}`, requestQuery),
    );
    if (response.isNegative || response.statusCode === 404) {
      return [];
    }
    const records: TmdbTitleRecord[] = [];
    const items = Array.isArray(response.responseJson.items) ? (response.responseJson.items as Record<string, unknown>[]) : [];
    for (const item of items) {
      const mediaType: TmdbTitleType = item.media_type === 'tv' ? 'tv' : 'movie';
      const record = toSearchTitleRecord(mediaType, item as SearchPayloadItem, opts.language);
      if (record) records.push(record);
    }
    return records.slice(0, limit);
  }

  async discoverTitlesByGenreExtended(client: DbClient, params: {
    mediaType: TmdbTitleType;
    genreId?: number | null;
    language?: string;
    region?: string;
    withWatchProviders?: number[];
    voteAverageGte?: number;
    releaseYear?: number;
    originalLanguage?: string;
    sortBy?: string;
    limit: number;
  }): Promise<TmdbTitleRecord[]> {
    const requestQuery: Record<string, string | number | undefined> = {
      page: 1,
      sort_by: params.sortBy ?? 'popularity.desc',
      include_adult: 'false',
    };
    if (params.genreId) requestQuery.with_genres = params.genreId;
    if (params.language) requestQuery.language = params.language;
    if (params.region) requestQuery.region = params.region;
    if (params.withWatchProviders?.length) requestQuery.with_watch_providers = params.withWatchProviders.join('|');
    if (typeof params.voteAverageGte === 'number') requestQuery['vote_average.gte'] = params.voteAverageGte;
    if (params.releaseYear) requestQuery.primary_release_year = params.releaseYear;
    if (params.originalLanguage) requestQuery.with_original_language = params.originalLanguage;

    const variantParts = [params.sortBy ?? 'popularity.desc', params.genreId ?? 'all', params.region ?? 'na', params.language ?? 'na'];
    const response = await this.responseCache.getOrFetch(
      client,
      {
        resourceType: 'discover',
        resourceId: null,
        variant: `genre-ext:${variantParts.join(':')}`,
        language: params.language ?? null,
        requestPath: `/discover/${params.mediaType}`,
        requestQuery,
      },
      'search',
      () => this.tmdbClient.request(`/discover/${params.mediaType}`, requestQuery),
    );
    if (response.isNegative || response.statusCode === 404) {
      return [];
    }
    const items = Array.isArray(response.responseJson.results) ? (response.responseJson.results as SearchPayloadItem[]) : [];
    return items
      .map((item) => toSearchTitleRecord(params.mediaType, item, params.language))
      .filter((item): item is TmdbTitleRecord => item !== null)
      .slice(0, params.limit);
  }
}
