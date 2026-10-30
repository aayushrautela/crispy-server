import type { DbClient } from '../../../lib/db.js';
import { normalizeMetadataLanguage } from '../metadata-language.js';
import type { MetadataSearchFilter } from '../metadata-detail.types.js';
import { enqueueTmdbEntityRefresh, enqueueTmdbSeasonWarmBatch } from '../../../lib/queue.js';
import { TmdbClient } from './tmdb.client.js';
import { TmdbIngestService } from './tmdb-ingest.service.js';
import { TmdbRepository } from './tmdb.repo.js';
import type {
  TmdbEpisodeRecord,
  TmdbPersonRecord,
  TmdbRelationKind,
  TmdbReviewRecord,
  TmdbSeasonRecord,
  TmdbTitleRecord,
  TmdbTitleType,
} from './tmdb.types.js';

const INGEST_CONCURRENCY = 4;

type PersonSearchPayloadItem = {
  id?: unknown;
  name?: unknown;
  known_for_department?: unknown;
  profile_path?: unknown;
  known_for?: unknown[];
  popularity?: unknown;
};

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let index = 0; index < items.length; index += concurrency) {
    const batch = items.slice(index, index + concurrency);
    results.push(...await Promise.all(batch.map(mapper)));
  }
  return results;
}

function isFresh(record: TmdbTitleRecord): boolean {
  return Date.parse(record.expiresAt) > Date.now();
}

/**
 * Read facade over the TMDB entity tables. Never parses provider JSON and
 * never talks to the TMDB API directly: cold keys are delegated to
 * TmdbIngestService, stale keys are served immediately while a background
 * refresh job is queued (stale-while-revalidate at the entity level).
 */
export class TmdbCacheService {
  constructor(
    private readonly tmdbRepository = new TmdbRepository(),
    private readonly ingest = new TmdbIngestService(),
    private readonly tmdbClient = new TmdbClient(),
  ) {}

  async getTitle(client: DbClient, mediaType: TmdbTitleType, tmdbId: number, language?: string | null): Promise<TmdbTitleRecord | null> {
    const lang = normalizeMetadataLanguage(language)?.split('-')[0] ?? 'en';
    const cached = await this.tmdbRepository.getTitle(client, mediaType, tmdbId, lang);
    if (cached?.hydrationLevel === 'not_found') {
      return null;
    }

    // Only serve detail records; summary is incomplete (no logos, credits, etc.)
    if (cached?.hydrationLevel === 'detail') {
      if (!isFresh(cached)) {
        this.scheduleEntityRefresh(mediaType, tmdbId);
      }
      return (await this.ensureTitleImages(client, mediaType, tmdbId, lang)) ?? cached;
    }

    // Cold key OR summary record → full hydrate
    await this.ingest.ingestTitle(client, mediaType, tmdbId, lang);
    const hydrated = await this.tmdbRepository.getTitle(client, mediaType, tmdbId, lang);
    return hydrated && hydrated.hydrationLevel !== 'not_found' ? hydrated : null;
  }

  async getTitles(client: DbClient, requests: Array<{ mediaType: TmdbTitleType; tmdbId: number }>, language?: string | null): Promise<Map<string, TmdbTitleRecord | null>> {
    const lang = normalizeMetadataLanguage(language)?.split('-')[0] ?? 'en';
    const unique = new Map<string, { mediaType: TmdbTitleType; tmdbId: number }>();
    for (const request of requests) {
      unique.set(`${request.mediaType}:${request.tmdbId}`, request);
    }

    const cached = await this.tmdbRepository.getTitles(client, [...unique.values()], lang);
    const results = new Map<string, TmdbTitleRecord | null>();
    const missing: Array<{ mediaType: TmdbTitleType; tmdbId: number }> = [];
    const imageCheck: Array<{ mediaType: TmdbTitleType; tmdbId: number }> = [];

    for (const [key, request] of unique) {
      const record = cached.get(key);
      if (!record || record.hydrationLevel === 'not_found') {
        missing.push(request);
        continue;
      }
      if (!isFresh(record)) {
        this.scheduleEntityRefresh(request.mediaType, request.tmdbId);
      }
      imageCheck.push(request);
    }

    // Cached records (any hydration level) → fill missing images inline so a
    // served card never lacks images the provider actually has.
    await mapWithConcurrency(imageCheck, INGEST_CONCURRENCY, async (request) => {
      const key = `${request.mediaType}:${request.tmdbId}`;
      const record = cached.get(key);
      try {
        results.set(key, (await this.ensureTitleImages(client, request.mediaType, request.tmdbId, lang)) ?? record ?? null);
      } catch {
        results.set(key, record ?? null);
      }
    });

    // Cold keys → full hydrate
    await mapWithConcurrency(missing, INGEST_CONCURRENCY, async (request) => {
      const key = `${request.mediaType}:${request.tmdbId}`;
      try {
        await this.ingest.ingestTitle(client, request.mediaType, request.tmdbId, lang);
        const hydrated = await this.tmdbRepository.getTitle(client, request.mediaType, request.tmdbId, lang);
        results.set(key, hydrated && hydrated.hydrationLevel !== 'not_found' ? hydrated : null);
      } catch {
        results.set(key, null);
      }
    });

    for (const key of unique.keys()) {
      if (!results.has(key)) {
        results.set(key, null);
      }
    }
    return results;
  }

  // ------------------------------------------------------------- seasons

  async getSeason(client: DbClient, showTmdbId: number, seasonNumber: number): Promise<TmdbSeasonRecord | null> {
    return this.ensureSeasonCached(client, showTmdbId, seasonNumber);
  }

  async getEpisode(client: DbClient, showTmdbId: number, seasonNumber: number, episodeNumber: number): Promise<TmdbEpisodeRecord | null> {
    const record = await this.tmdbRepository.getEpisode(client, showTmdbId, seasonNumber, episodeNumber);
    if (!record) {
      this.scheduleSeasonWarm(showTmdbId, seasonNumber);
    }
    return record;
  }

  async getEpisodes(client: DbClient, requests: Array<{ showTmdbId: number; seasonNumber: number; episodeNumber: number }>): Promise<Map<string, TmdbEpisodeRecord | null>> {
    const records = requests.length ? await this.tmdbRepository.getEpisodes(client, requests) : new Map<string, TmdbEpisodeRecord>();
    const result = new Map<string, TmdbEpisodeRecord | null>();
    const missingSeasons = new Map<number, Set<number>>();
    for (const req of requests) {
      const key = `${req.showTmdbId}:${req.seasonNumber}:${req.episodeNumber}`;
      const record = records.get(key) ?? null;
      result.set(key, record);
      if (!record) {
        const seasons = missingSeasons.get(req.showTmdbId) ?? new Set<number>();
        seasons.add(req.seasonNumber);
        missingSeasons.set(req.showTmdbId, seasons);
      }
    }
    for (const [showTmdbId, seasons] of missingSeasons) {
      for (const seasonNumber of seasons) {
        this.scheduleSeasonWarm(showTmdbId, seasonNumber);
      }
    }
    return result;
  }

  async getSeasons(client: DbClient, requests: Array<{ showTmdbId: number; seasonNumber: number }>): Promise<Map<string, TmdbSeasonRecord | null>> {
    const records = requests.length ? await this.tmdbRepository.getSeasons(client, requests) : new Map<string, TmdbSeasonRecord>();
    const result = new Map<string, TmdbSeasonRecord | null>();
    for (const req of requests) {
      const key = `${req.showTmdbId}:${req.seasonNumber}`;
      const record = records.get(key) ?? null;
      result.set(key, record);
      if (!record) {
        this.scheduleSeasonWarm(req.showTmdbId, req.seasonNumber);
      }
    }
    return result;
  }

  async getSeasonEpisodes(client: DbClient, showTmdbId: number, seasonNumber: number): Promise<TmdbEpisodeRecord[]> {
    await this.ensureSeasonCached(client, showTmdbId, seasonNumber);
    return this.tmdbRepository.getSeasonEpisodes(client, showTmdbId, seasonNumber);
  }

  async refreshSeason(client: DbClient, showTmdbId: number, seasonNumber: number): Promise<void> {
    await this.ingest.ingestSeason(client, showTmdbId, seasonNumber);
  }

  async ensureSeasonCached(client: DbClient, showTmdbId: number, seasonNumber: number): Promise<TmdbSeasonRecord | null> {
    const cached = await this.tmdbRepository.getSeason(client, showTmdbId, seasonNumber);
    if (cached && Date.parse(cached.expiresAt) > Date.now()) {
      return cached;
    }

    try {
      await this.ingest.ingestSeason(client, showTmdbId, seasonNumber);
      return this.tmdbRepository.getSeason(client, showTmdbId, seasonNumber);
    } catch (error) {
      if (cached) {
        return cached;
      }
      throw error;
    }
  }

  // ------------------------------------------------------------ relations

  async getRelatedTitles(client: DbClient, sourceMediaType: TmdbTitleType | 'collection', sourceTmdbId: number, relationKind: TmdbRelationKind, language?: string | null): Promise<TmdbTitleRecord[]> {
    const lang = normalizeMetadataLanguage(language)?.split('-')[0] ?? 'en';
    return this.tmdbRepository.getRelatedTitles(client, sourceMediaType, sourceTmdbId, relationKind, lang);
  }

  async ensureCollectionCached(client: DbClient, collectionId: number, language?: string | null): Promise<boolean> {
    try {
      return await this.ingest.ensureCollectionCached(client, collectionId, language);
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------- reviews

  async getReviews(client: DbClient, mediaType: TmdbTitleType, tmdbId: number, limit = 15): Promise<TmdbReviewRecord[]> {
    return this.tmdbRepository.getReviews(client, mediaType, tmdbId, limit);
  }

  // --------------------------------------------------------------- search

  /**
   * Live-only title search. Results are never read from or written to the
   * local cache: TMDB's relevance order is the ranking, so payloads are
   * mapped and returned directly in payload order.
   */
  async searchTitles(_client: DbClient, query: string, limit: number, mediaTypes: TmdbTitleType[], locale?: string | null): Promise<TmdbTitleRecord[]> {
    const lang = normalizeMetadataLanguage(locale)?.split('-')[0] ?? 'en';
    const searchableTypes = mediaTypes.filter((mediaType) => mediaType === 'movie' || mediaType === 'tv');
    if (!searchableTypes.length) {
      return [];
    }

    const payloads = await Promise.all(
      searchableTypes.map(async (mediaType) => ({
        mediaType,
        payload: await this.tmdbClient.request(`/search/${mediaType}`, {
          query,
          page: 1,
          include_adult: 'false',
          language: locale ? toLanguageQuery(locale) : undefined,
        }).catch(() => null),
      })),
    );

    const results: TmdbTitleRecord[] = [];
    for (const { mediaType, payload } of payloads) {
      if (!payload) continue;
      const mapped = asArray(payload.results)
        .map((item) => mapLiveTitle(item as Record<string, unknown>, mediaType, lang))
        .filter((record): record is TmdbTitleRecord => record !== null)
        .slice(0, limit);
      results.push(...mapped);
    }
    return results;
  }

  async discoverTitlesByGenre(_client: DbClient, params: {
    movieGenreId?: number | null;
    tvGenreId?: number | null;
    filter: MetadataSearchFilter;
    limit: number;
    locale?: string | null;
  }): Promise<TmdbTitleRecord[]> {
    const lang = normalizeMetadataLanguage(params.locale)?.split('-')[0] ?? 'en';
    const requested: Array<{ mediaType: TmdbTitleType; genreId: number }> = [];
    if ((params.filter === 'movies' || params.filter === 'all') && params.movieGenreId) {
      requested.push({ mediaType: 'movie', genreId: params.movieGenreId });
    }
    if ((params.filter === 'series' || params.filter === 'all') && params.tvGenreId) {
      requested.push({ mediaType: 'tv', genreId: params.tvGenreId });
    }
    if (!requested.length) {
      return [];
    }

    // Live-only, like title search: discover payloads are mapped and ranked by
    // the endpoint's own popularity sort, never persisted or re-read locally.
    const livePayloads = await Promise.all(requested.map(async ({ mediaType, genreId }) => ({
      mediaType,
      payload: await this.tmdbClient.request(`/discover/${mediaType}`, {
        with_genres: genreId,
        page: 1,
        sort_by: 'popularity.desc',
        include_adult: 'false',
      }).catch(() => null),
    })));

    const results: TmdbTitleRecord[] = [];
    for (const { mediaType, payload } of livePayloads) {
      if (!payload) continue;
      for (const item of asArray(payload.results)) {
        const record = mapLiveTitle(item as Record<string, unknown>, mediaType, lang);
        if (record) results.push(record);
      }
    }
    return dedupeTitles(results)
      .sort((left, right) => popularityOf(right) - popularityOf(left))
      .slice(0, params.limit);
  }

  async discoverTitlesByGenres(client: DbClient, params: {
    mediaType: TmdbTitleType;
    genreIds: number[];
    limit: number;
    locale?: string | null;
    excludeTmdbId?: number | null;
  }): Promise<TmdbTitleRecord[]> {
    if (!params.genreIds.length || params.limit <= 0) return [];
    const lang = normalizeMetadataLanguage(params.locale)?.split('-')[0] ?? 'en';
    const locale = params.locale ?? null;

    const payload = await this.tmdbClient.request(`/discover/${params.mediaType}`, {
      with_genres: params.genreIds.join(','),
      page: 1,
      sort_by: 'popularity.desc',
      include_adult: 'false',
    }).catch(() => null);
    if (payload) {
      await this.ingest.persistSummaries(client, asArray(payload.results) as Record<string, unknown>[], params.mediaType, locale);
    }

    const refreshed = await this.tmdbRepository.discoverTitlesByGenres(
      client,
      params.mediaType,
      params.genreIds,
      params.limit + (params.excludeTmdbId ? 1 : 0),
      lang,
    );
    return refreshed
      .filter((title) => title.tmdbId !== params.excludeTmdbId)
      .sort((left, right) => popularityOf(right) - popularityOf(left))
      .slice(0, params.limit);
  }

  /**
   * Live-only people search, same rule as titles: never cached, TMDB order.
   */
  async searchPeople(_client: DbClient, query: string, limit: number, signal?: AbortSignal): Promise<TmdbPersonRecord[]> {
    const payload = await this.tmdbClient.request('/search/person', { query, page: 1, include_adult: 'false' }, signal).catch(() => null);
    if (!payload) {
      return [];
    }

    return asArray(payload.results)
      .map((item) => mapLivePerson(item as PersonSearchPayloadItem))
      .filter((person): person is TmdbPersonRecord => person !== null)
      .slice(0, limit);
  }

  // --------------------------------------------------------------- people

  async getPerson(client: DbClient, personTmdbId: number): Promise<TmdbPersonRecord | null> {
    return this.tmdbRepository.getPerson(client, personTmdbId);
  }

  async ingestPerson(client: DbClient, personTmdbId: number, language?: string | null): Promise<TmdbPersonRecord | null> {
    return this.ingest.ingestPerson(client, personTmdbId, language);
  }

  async getPersonCredits(client: DbClient, personTmdbId: number, language?: string | null): Promise<Array<{ title: TmdbTitleRecord; character: string | null; job: string | null }>> {
    const lang = normalizeMetadataLanguage(language)?.split('-')[0] ?? 'en';
    return this.tmdbRepository.getPersonKnownFor(client, personTmdbId, lang);
  }

  protected scheduleEntityRefresh(mediaType: TmdbTitleType, tmdbId: number): void {
    enqueueTmdbEntityRefresh(mediaType, tmdbId).catch(() => {});
  }

  protected scheduleSeasonWarm(showTmdbId: number, seasonNumber: number): void {
    enqueueTmdbSeasonWarmBatch(showTmdbId, [seasonNumber]).catch(() => {});
  }

  /**
   * Fills image kinds missing from a served title record. Returns the
   * refreshed record, or null when nothing was missing or the fetch failed —
   * callers then serve the cached record. Reads never break on TMDB errors.
   */
  private async ensureTitleImages(
    client: DbClient,
    mediaType: TmdbTitleType,
    tmdbId: number,
    language: string,
  ): Promise<TmdbTitleRecord | null> {
    try {
      const missing = await this.tmdbRepository.missingImageKinds(client, mediaType, tmdbId);
      if (missing.length === 0) {
        return null;
      }
      await this.ingest.fetchImages(client, mediaType, tmdbId, language);
      return this.tmdbRepository.getTitle(client, mediaType, tmdbId, language);
    } catch {
      return null;
    }
  }
}

function toLanguageQuery(language: string): string {
  return language.includes('-') ? language : language === 'en' ? 'en-US' : language;
}

function popularityOf(record: TmdbTitleRecord): number {
  const value = record.raw.popularity;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function dedupeTitles(records: TmdbTitleRecord[]): TmdbTitleRecord[] {
  const seen = new Set<string>();
  const deduped: TmdbTitleRecord[] = [];
  for (const record of records) {
    const key = `${record.mediaType}:${record.tmdbId}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(record);
    }
  }
  return deduped;
}

function mapLiveTitle(item: Record<string, unknown>, mediaType: TmdbTitleType, language: string): TmdbTitleRecord | null {
  const tmdbId = typeof item.id === 'number' && Number.isFinite(item.id) ? item.id : null;
  if (!tmdbId) {
    return null;
  }

  const now = new Date().toISOString();
  return {
    mediaType,
    tmdbId,
    language,
    name: toNullableString(item.title) ?? toNullableString(item.name),
    originalName: toNullableString(item.original_title) ?? toNullableString(item.original_name),
    overview: toNullableString(item.overview),
    tagline: null,
    releaseDate: toNullableString(item.release_date),
    firstAirDate: toNullableString(item.first_air_date),
    status: null,
    posterPath: toNullableString(item.poster_path),
    backdropPath: toNullableString(item.backdrop_path),
    runtime: null,
    episodeRunTime: [],
    numberOfSeasons: null,
    numberOfEpisodes: null,
    externalIds: {},
    genreIds: asArray(item.genre_ids).map(Number).filter(Number.isFinite),
    voteAverage: typeof item.vote_average === 'number' && Number.isFinite(item.vote_average) ? item.vote_average : null,
    raw: item,
    fetchedAt: now,
    expiresAt: now,
  };
}

function mapLivePerson(item: PersonSearchPayloadItem): TmdbPersonRecord | null {
  const tmdbPersonId = typeof item?.id === 'number' ? item.id : null;
  const name = toNullableString(item?.name);
  if (!tmdbPersonId || !name) {
    return null;
  }

  return {
    tmdbPersonId,
    name,
    knownForDepartment: toNullableString(item.known_for_department),
    biography: null,
    birthday: null,
    deathday: null,
    placeOfBirth: null,
    profilePath: toNullableString(item.profile_path),
    popularity: typeof item.popularity === 'number' ? item.popularity : 0,
    homepage: null,
    knownFor: asArray(item.known_for)
      .map((entry) => entry as Record<string, unknown>)
      .map((entry) => ({
        mediaType: typeof entry.media_type === 'string' ? entry.media_type : 'movie',
        title: toNullableString(entry.title) ?? toNullableString(entry.name),
        tmdbId: typeof entry.id === 'number' ? entry.id : 0,
      }))
      .filter((entry) => Boolean(entry.title)),
    fetchedAt: new Date().toISOString(),
    expiresAt: new Date().toISOString(),
  };
}
