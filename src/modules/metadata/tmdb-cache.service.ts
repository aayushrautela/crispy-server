import { addHours } from './tmdb-time.js';
import { env } from '../../config/env.js';
import type { DbClient } from '../../lib/db.js';
import { TmdbClient } from './tmdb.client.js';
import { TmdbRepository } from './tmdb.repo.js';
import type { TmdbEpisodeRecord, TmdbTitleRecord, TmdbTitleType } from './tmdb.types.js';

function toNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function toNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export class TmdbCacheService {
  constructor(
    private readonly tmdbRepository = new TmdbRepository(),
    private readonly tmdbClient = new TmdbClient(),
  ) {}

  async getTitle(client: DbClient, mediaType: TmdbTitleType, tmdbId: number): Promise<TmdbTitleRecord | null> {
    const cached = await this.tmdbRepository.getTitle(client, mediaType, tmdbId);
    if (cached && Date.parse(cached.expiresAt) > Date.now()) {
      return cached;
    }

    const fetched = await this.refreshTitle(client, mediaType, tmdbId);
    return fetched ?? cached;
  }

  async refreshTitle(client: DbClient, mediaType: TmdbTitleType, tmdbId: number): Promise<TmdbTitleRecord | null> {
    const title = await this.tmdbClient.fetchTitle(mediaType, tmdbId);
    const externalIds = await this.tmdbClient.fetchExternalIds(mediaType, tmdbId);
    const now = new Date().toISOString();
    const ttlHours = mediaType === 'movie' ? env.tmdbMovieTtlHours : env.tmdbShowTtlHours;
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

  async refreshSeason(client: DbClient, showTmdbId: number, seasonNumber: number): Promise<void> {
    const season = await this.tmdbClient.fetchSeason(showTmdbId, seasonNumber);
    const now = new Date().toISOString();
    const expiresAt = addHours(now, env.tmdbSeasonTtlHours);
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

  async listEpisodesForShow(client: DbClient, showTmdbId: number): Promise<TmdbEpisodeRecord[]> {
    return this.tmdbRepository.listEpisodesForShow(client, showTmdbId);
  }
}
