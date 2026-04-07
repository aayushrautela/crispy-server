import { addHours } from './tmdb-time.js';
import { appConfig } from '../../../config/app-config.js';
import type { DbClient } from '../../../lib/db.js';
import { HttpError } from '../../../lib/errors.js';
import { TmdbClient } from './tmdb.client.js';
import { TmdbRepository } from './tmdb.repo.js';
import type { MetadataSearchFilter } from '../metadata-detail.types.js';
import type { TmdbEpisodeRecord, TmdbSeasonRecord, TmdbTitleRecord, TmdbTitleType } from './tmdb.types.js';

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

function toSearchTitleRecord(mediaType: TmdbTitleType, item: SearchPayloadItem): TmdbTitleRecord | null {
  const tmdbId = typeof item?.id === 'number' ? item.id : null;
  if (!tmdbId) {
    return null;
  }

  const now = new Date().toISOString();
  return {
    mediaType,
    tmdbId,
    name: toNullableString(item.title) ?? toNullableString(item.name),
    originalName: toNullableString(item.original_title) ?? toNullableString(item.original_name),
    overview: toNullableString(item.overview),
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

function toNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function toNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function hasRecommendationPayload(record: TmdbTitleRecord): boolean {
  const recommendations = (record.raw as Record<string, unknown>).recommendations;
  return typeof recommendations === 'object' && recommendations !== null;
}

function usesLegacySimilarPayload(record: TmdbTitleRecord): boolean {
  const raw = record.raw as Record<string, unknown>;
  return !hasRecommendationPayload(record) && typeof raw.similar === 'object' && raw.similar !== null;
}

export class TmdbCacheService {
  constructor(
    private readonly tmdbRepository = new TmdbRepository(),
    private readonly tmdbClient = new TmdbClient(),
  ) {}

  async getTitle(client: DbClient, mediaType: TmdbTitleType, tmdbId: number): Promise<TmdbTitleRecord | null> {
    const cached = await this.tmdbRepository.getTitle(client, mediaType, tmdbId);
    const hasLegacySimilarPayload = cached ? usesLegacySimilarPayload(cached) : false;
    if (cached && !hasLegacySimilarPayload && Date.parse(cached.expiresAt) > Date.now()) {
      return cached;
    }

    try {
      const fetched = await this.refreshTitle(client, mediaType, tmdbId);
      return fetched ?? cached;
    } catch (error) {
      if (cached && !hasLegacySimilarPayload) {
        return cached;
      }
      throw error;
    }
  }

  async refreshTitle(client: DbClient, mediaType: TmdbTitleType, tmdbId: number): Promise<TmdbTitleRecord | null> {
    const title = await this.tmdbClient.fetchTitle(mediaType, tmdbId);
    const externalIds = await this.tmdbClient.fetchExternalIds(mediaType, tmdbId);
    const now = new Date().toISOString();
    const ttlHours = mediaType === 'movie' ? appConfig.cache.tmdb.movieTtlHours : appConfig.cache.tmdb.showTtlHours;
    const record: TmdbTitleRecord = {
      mediaType,
      tmdbId,
      name: toNullableString(title.title) ?? toNullableString(title.name),
      originalName: toNullableString(title.original_title) ?? toNullableString(title.original_name),
      overview: toNullableString(title.overview),
      releaseDate: toNullableString(title.release_date),
      firstAirDate: toNullableString(title.first_air_date),
      status: toNullableString(title.status),
      posterPath: toNullableString(title.poster_path),
      backdropPath: toNullableString(title.backdrop_path),
      runtime: toNullableNumber(title.runtime),
      episodeRunTime: Array.isArray(title.episode_run_time) ? title.episode_run_time.map((value) => Number(value)) : [],
      numberOfSeasons: toNullableNumber(title.number_of_seasons),
      numberOfEpisodes: toNullableNumber(title.number_of_episodes),
      externalIds,
      raw: title,
      fetchedAt: now,
      expiresAt: addHours(now, ttlHours),
    };
    await this.tmdbRepository.upsertTitle(client, record);
    return record;
  }

  async getCollection(client: DbClient, collectionId: number): Promise<Record<string, unknown> | null> {
    try {
      return await this.tmdbClient.fetchCollection(collectionId);
    } catch (error) {
      if (error instanceof HttpError && error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  async ensureTitleCached(client: DbClient, mediaType: TmdbTitleType, tmdbId: number): Promise<TmdbTitleRecord | null> {
    return this.getTitle(client, mediaType, tmdbId);
  }

  async refreshSeason(client: DbClient, showTmdbId: number, seasonNumber: number): Promise<void> {
    const season = await this.tmdbClient.fetchSeason(showTmdbId, seasonNumber);
    const now = new Date().toISOString();
    const expiresAt = addHours(now, appConfig.cache.tmdb.seasonTtlHours);
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

  async getEpisode(
    client: DbClient,
    showTmdbId: number,
    seasonNumber: number,
    episodeNumber: number,
  ): Promise<TmdbEpisodeRecord | null> {
    return this.tmdbRepository.getEpisode(client, showTmdbId, seasonNumber, episodeNumber);
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

  async listEpisodesForShow(client: DbClient, showTmdbId: number): Promise<TmdbEpisodeRecord[]> {
    return this.tmdbRepository.listEpisodesForShow(client, showTmdbId);
  }

  async listEpisodesForSeason(client: DbClient, showTmdbId: number, seasonNumber: number): Promise<TmdbEpisodeRecord[]> {
    return this.tmdbRepository.listEpisodesForSeason(client, showTmdbId, seasonNumber);
  }

  async searchTitles(query: string, limit: number, mediaTypes: TmdbTitleType[], locale?: string | null): Promise<TmdbTitleRecord[]> {
    const payloads = await Promise.all(mediaTypes.map((mediaType) => this.tmdbClient.searchTitles(mediaType, query, 1, locale)));
    const records = payloads.flatMap((payload, index) => {
      const mediaType = mediaTypes[index] as TmdbTitleType;
      const items = Array.isArray(payload.results) ? payload.results as SearchPayloadItem[] : [];
      return items
        .map((item) => toSearchTitleRecord(mediaType, item))
        .filter((item): item is TmdbTitleRecord => item !== null);
    });

    return sortSearchResults(query, dedupeTitles(records)).slice(0, limit);
  }

  async discoverTitlesByGenre(params: {
      movieGenreId?: number | null;
      tvGenreId?: number | null;
      filter: MetadataSearchFilter;
      limit: number;
    }): Promise<TmdbTitleRecord[]> {
    const requestedTypes: Array<{ mediaType: TmdbTitleType; genreId: number }> = [];
    if ((params.filter === 'movies' || params.filter === 'all') && params.movieGenreId) {
      requestedTypes.push({ mediaType: 'movie', genreId: params.movieGenreId });
    }

    const payloads = await Promise.all(
      requestedTypes.map(({ mediaType, genreId }) => this.tmdbClient.discoverTitlesByGenre(mediaType, genreId)),
    );
    const records = payloads.flatMap((payload, index) => {
      const mediaType = requestedTypes[index]?.mediaType;
      if (!mediaType) {
        return [];
      }
      const items = Array.isArray(payload.results) ? payload.results as SearchPayloadItem[] : [];
      return items
        .map((item) => toSearchTitleRecord(mediaType, item))
        .filter((item): item is TmdbTitleRecord => item !== null);
    });

    return sortDiscoverResults(dedupeTitles(records)).slice(0, params.limit);
  }
}
