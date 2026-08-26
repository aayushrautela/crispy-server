import type { DbClient } from '../../../lib/db.js';
import { normalizeMetadataLanguage } from '../metadata-language.js';
import type { MetadataSearchFilter, SearchSuggestionItem } from '../metadata-detail.types.js';
import { enqueueTmdbEntityRefresh } from '../../../lib/queue.js';
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
const LOCAL_SEARCH_MIN_RESULTS = 5;

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
    if (cached) {
      if (!isFresh(cached)) {
        this.scheduleEntityRefresh(mediaType, tmdbId);
      }
      return cached;
    }

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

    for (const [key, request] of unique) {
      const record = cached.get(key);
      if (!record || record.hydrationLevel === 'not_found') {
        missing.push(request);
        continue;
      }
      if (!isFresh(record)) {
        this.scheduleEntityRefresh(request.mediaType, request.tmdbId);
      }
      results.set(key, record);
    }

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

  async getSeasons(client: DbClient, requests: Array<{ showTmdbId: number; seasonNumber: number }>): Promise<Map<string, TmdbSeasonRecord | null>> {
    const records = requests.length ? await this.tmdbRepository.getSeasons(client, requests) : new Map<string, TmdbSeasonRecord>();
    const result = new Map<string, TmdbSeasonRecord | null>();
    for (const req of requests) {
      const key = `${req.showTmdbId}:${req.seasonNumber}`;
      result.set(key, records.get(key) ?? null);
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

  async searchTitles(client: DbClient, query: string, limit: number, mediaTypes: TmdbTitleType[], locale?: string | null): Promise<TmdbTitleRecord[]> {
    const lang = normalizeMetadataLanguage(locale)?.split('-')[0] ?? 'en';
    const searchableTypes = mediaTypes.filter((mediaType) => mediaType === 'movie' || mediaType === 'tv');
    const localResults = await this.tmdbRepository.searchTitles(client, query, limit, mediaTypes, lang);

    if (localResults.length >= Math.min(LOCAL_SEARCH_MIN_RESULTS, limit) || !searchableTypes.length) {
      return localResults;
    }

    const payloads = await Promise.all(
      searchableTypes.map((mediaType) =>
        this.tmdbClient.request(`/search/${mediaType}`, {
          query,
          page: 1,
          include_adult: 'false',
          language: locale ? toLanguageQuery(locale) : undefined,
        }).catch(() => null),
      ),
    );

    for (const payload of payloads) {
      if (!payload) continue;
      await this.ingest.persistSummaries(client, asArray(payload.results) as Record<string, unknown>[], searchableTypes[0]);
    }

    const refreshed = await this.tmdbRepository.searchTitles(client, query, limit, mediaTypes, lang);
    return (refreshed.length > localResults.length ? refreshed : localResults).slice(0, limit);
  }

  async discoverTitlesByGenre(client: DbClient, params: {
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

    const localResults = (
      await Promise.all(requested.map(({ mediaType, genreId }) =>
        this.tmdbRepository.discoverTitlesByGenre(client, mediaType, genreId, params.limit, lang),
      ))
    ).flat();

    if (localResults.length >= Math.min(LOCAL_SEARCH_MIN_RESULTS, params.limit)) {
      return dedupeTitles(localResults)
        .sort((left, right) => popularityOf(right) - popularityOf(left))
        .slice(0, params.limit);
    }

    const liveResults = (
      await Promise.all(requested.map(({ mediaType, genreId }) =>
        this.tmdbClient.request(`/discover/${mediaType}`, {
          with_genres: genreId,
          page: 1,
          sort_by: 'popularity.desc',
          include_adult: 'false',
        }).catch(() => null),
      ))
    ).flat().filter(Boolean) as Array<Record<string, unknown>>;

    for (const payload of liveResults) {
      await this.ingest.persistSummaries(client, asArray(payload.results) as Record<string, unknown>[]);
    }

    const refreshed = (
      await Promise.all(requested.map(({ mediaType, genreId }) =>
        this.tmdbRepository.discoverTitlesByGenre(client, mediaType, genreId, params.limit, lang),
      ))
    ).flat();
    return dedupeTitles(refreshed.length >= localResults.length ? refreshed : localResults)
      .sort((left, right) => popularityOf(right) - popularityOf(left))
      .slice(0, params.limit);
  }

  async searchPeople(client: DbClient, query: string, limit: number, signal?: AbortSignal): Promise<TmdbPersonRecord[]> {
    const localResults = await this.tmdbRepository.searchPeople(client, query, limit);
    if (localResults.length >= Math.min(LOCAL_SEARCH_MIN_RESULTS, limit)) {
      return localResults;
    }

    const payload = await this.tmdbClient.request('/search/person', { query, page: 1, include_adult: 'false' }, signal).catch(() => null);
    if (!payload) {
      return localResults;
    }

    const mapped = (asArray(payload.results) as Record<string, unknown>[])
      .map((item) => item as PersonSearchPayloadItem)
      .map((item) => mapLivePerson(item))
      .filter((person): person is TmdbPersonRecord => person !== null)
      .slice(0, limit);

    for (const person of mapped) {
      await this.tmdbRepository.upsertPerson(client, {
        tmdbPersonId: person.tmdbPersonId,
        name: person.name,
        knownForDepartment: person.knownForDepartment,
        biography: null,
        birthday: null,
        deathday: null,
        placeOfBirth: null,
        profilePath: person.profilePath,
        popularity: person.popularity,
        homepage: null,
        adult: false,
        alsoKnownAs: [],
        raw: {},
        fetchedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 24 * 3_600_000).toISOString(),
      });
    }

    return mapped.length > 0 ? mapped : localResults;
  }

  async searchSuggestions(client: DbClient, query: string, limit: number, filter: MetadataSearchFilter, locale?: string | null): Promise<SearchSuggestionItem[]> {
    const titles = await this.searchTitles(client, query, limit, filter === 'movies' ? ['movie'] : filter === 'series' ? ['tv'] : ['movie', 'tv'], locale);

    const suggestions: SearchSuggestionItem[] = [];
    for (const record of titles) {
      if (!record.name) continue;
      const year = Number.parseInt((record.releaseDate ?? record.firstAirDate ?? '').slice(0, 4), 10);
      const posterPath = record.posterPath;
      const primary = posterPath ? {
        small: `https://image.tmdb.org/t/p/w185${posterPath}`,
        medium: `https://image.tmdb.org/t/p/w342${posterPath}`,
        large: `https://image.tmdb.org/t/p/w500${posterPath}`,
      } : null;

      suggestions.push({
        Id: String(record.tmdbId),
        Type: record.mediaType === 'movie' ? 'Movie' : 'Series',
        Name: record.name,
        ProductionYear: Number.isInteger(year) ? year : null,
        ImageTags: primary ? { Primary: primary } : null,
        ProviderIds: { Tmdb: String(record.tmdbId) },
      });
    }

    suggestions.sort((a, b) => (b.ProductionYear ?? 0) - (a.ProductionYear ?? 0));
    return suggestions.slice(0, limit);
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
