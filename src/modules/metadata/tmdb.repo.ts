import type { DbClient } from '../../lib/db.js';
import { requireDbIsoString } from '../../lib/time.js';
import type { TmdbEpisodeRecord, TmdbSeasonRecord, TmdbTitleRecord, TmdbTitleType } from './tmdb.types.js';

function mapTitle(row: Record<string, unknown>): TmdbTitleRecord {
  return {
    mediaType: String(row.media_type) as TmdbTitleType,
    tmdbId: Number(row.tmdb_id),
    name: typeof row.name === 'string' ? row.name : null,
    originalName: typeof row.original_name === 'string' ? row.original_name : null,
    overview: typeof row.overview === 'string' ? row.overview : null,
    releaseDate: row.release_date ? String(row.release_date) : null,
    firstAirDate: row.first_air_date ? String(row.first_air_date) : null,
    status: typeof row.status === 'string' ? row.status : null,
    posterPath: typeof row.poster_path === 'string' ? row.poster_path : null,
    backdropPath: typeof row.backdrop_path === 'string' ? row.backdrop_path : null,
    runtime: row.runtime === null || row.runtime === undefined ? null : Number(row.runtime),
    episodeRunTime: Array.isArray(row.episode_run_time) ? row.episode_run_time.map((value) => Number(value)) : [],
    numberOfSeasons: row.number_of_seasons === null || row.number_of_seasons === undefined ? null : Number(row.number_of_seasons),
    numberOfEpisodes: row.number_of_episodes === null || row.number_of_episodes === undefined ? null : Number(row.number_of_episodes),
    externalIds: (row.external_ids as Record<string, unknown> | undefined) ?? {},
    raw: (row.raw as Record<string, unknown> | undefined) ?? {},
    fetchedAt: requireDbIsoString(row.fetched_at as Date | string | null | undefined, 'tmdb_titles.fetched_at'),
    expiresAt: requireDbIsoString(row.expires_at as Date | string | null | undefined, 'tmdb_titles.expires_at'),
  };
}

function mapSearchTitle(row: Record<string, unknown>): TmdbTitleRecord {
  return {
    mediaType: String(row.media_type) as TmdbTitleType,
    tmdbId: Number(row.tmdb_id),
    name: typeof row.name === 'string' ? row.name : null,
    originalName: typeof row.original_name === 'string' ? row.original_name : null,
    overview: typeof row.overview === 'string' ? row.overview : null,
    releaseDate: row.release_date ? String(row.release_date) : null,
    firstAirDate: row.first_air_date ? String(row.first_air_date) : null,
    status: typeof row.status === 'string' ? row.status : null,
    posterPath: typeof row.poster_path === 'string' ? row.poster_path : null,
    backdropPath: typeof row.backdrop_path === 'string' ? row.backdrop_path : null,
    runtime: null,
    episodeRunTime: [],
    numberOfSeasons: null,
    numberOfEpisodes: null,
    externalIds: {},
    raw: {},
    fetchedAt: requireDbIsoString(row.fetched_at as Date | string | null | undefined, 'tmdb_titles.fetched_at'),
    expiresAt: requireDbIsoString(row.expires_at as Date | string | null | undefined, 'tmdb_titles.expires_at'),
  };
}

function mapEpisode(row: Record<string, unknown>): TmdbEpisodeRecord {
  return {
    showTmdbId: Number(row.show_tmdb_id),
    seasonNumber: Number(row.season_number),
    episodeNumber: Number(row.episode_number),
    tmdbId: row.tmdb_id === null || row.tmdb_id === undefined ? null : Number(row.tmdb_id),
    name: typeof row.name === 'string' ? row.name : null,
    overview: typeof row.overview === 'string' ? row.overview : null,
    airDate: row.air_date ? String(row.air_date) : null,
    runtime: row.runtime === null || row.runtime === undefined ? null : Number(row.runtime),
    stillPath: typeof row.still_path === 'string' ? row.still_path : null,
    voteAverage: row.vote_average === null || row.vote_average === undefined ? null : Number(row.vote_average),
    raw: (row.raw as Record<string, unknown> | undefined) ?? {},
    fetchedAt: requireDbIsoString(row.fetched_at as Date | string | null | undefined, 'tmdb_tv_episodes.fetched_at'),
    expiresAt: requireDbIsoString(row.expires_at as Date | string | null | undefined, 'tmdb_tv_episodes.expires_at'),
  };
}

function mapSeason(row: Record<string, unknown>): TmdbSeasonRecord {
  return {
    showTmdbId: Number(row.show_tmdb_id),
    seasonNumber: Number(row.season_number),
    name: typeof row.name === 'string' ? row.name : null,
    overview: typeof row.overview === 'string' ? row.overview : null,
    airDate: row.air_date ? String(row.air_date) : null,
    posterPath: typeof row.poster_path === 'string' ? row.poster_path : null,
    episodeCount: row.episode_count === null || row.episode_count === undefined ? null : Number(row.episode_count),
    raw: (row.raw as Record<string, unknown> | undefined) ?? {},
    fetchedAt: requireDbIsoString(row.fetched_at as Date | string | null | undefined, 'tmdb_tv_seasons.fetched_at'),
    expiresAt: requireDbIsoString(row.expires_at as Date | string | null | undefined, 'tmdb_tv_seasons.expires_at'),
  };
}

export class TmdbRepository {
  async searchTitles(client: DbClient, query: string, limit: number, mediaTypes: TmdbTitleType[]): Promise<TmdbTitleRecord[]> {
    const result = await client.query(
      `
        SELECT media_type, tmdb_id, name, original_name, overview, release_date, first_air_date, status,
               poster_path, backdrop_path, fetched_at, expires_at,
               CASE
                  WHEN lower(coalesce(name, '')) = lower($1) THEN 0
                  WHEN lower(coalesce(original_name, '')) = lower($1) THEN 1
                 WHEN lower(coalesce(name, '')) LIKE lower($1) || '%' THEN 2
                 WHEN lower(coalesce(original_name, '')) LIKE lower($1) || '%' THEN 3
                 ELSE 4
               END AS rank_order
        FROM tmdb_titles
        WHERE media_type = ANY($3::text[])
          AND (
            lower(coalesce(name, '')) LIKE '%' || lower($1) || '%'
           OR lower(coalesce(original_name, '')) LIKE '%' || lower($1) || '%'
          )
        ORDER BY rank_order ASC, fetched_at DESC
        LIMIT $2
      `,
      [query, limit, mediaTypes],
    );

    return result.rows.map((row) => mapSearchTitle(row));
  }

  async getTitle(client: DbClient, mediaType: TmdbTitleType, tmdbId: number): Promise<TmdbTitleRecord | null> {
    const result = await client.query(
      `
        SELECT media_type, tmdb_id, name, original_name, overview, release_date, first_air_date, status,
               poster_path, backdrop_path, runtime, episode_run_time, number_of_seasons, number_of_episodes,
               external_ids, raw, fetched_at, expires_at
        FROM tmdb_titles
        WHERE media_type = $1 AND tmdb_id = $2
      `,
      [mediaType, tmdbId],
    );
    return result.rows[0] ? mapTitle(result.rows[0]) : null;
  }

  async upsertTitle(client: DbClient, record: TmdbTitleRecord): Promise<void> {
    await client.query(
      `
        INSERT INTO tmdb_titles (
          media_type, tmdb_id, name, original_name, overview, release_date, first_air_date, status,
          poster_path, backdrop_path, runtime, episode_run_time, number_of_seasons, number_of_episodes,
          external_ids, raw, fetched_at, expires_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6::date, $7::date, $8,
          $9, $10, $11, $12::jsonb, $13, $14,
          $15::jsonb, $16::jsonb, $17::timestamptz, $18::timestamptz
        )
        ON CONFLICT (media_type, tmdb_id)
        DO UPDATE SET
          name = EXCLUDED.name,
          original_name = EXCLUDED.original_name,
          overview = EXCLUDED.overview,
          release_date = EXCLUDED.release_date,
          first_air_date = EXCLUDED.first_air_date,
          status = EXCLUDED.status,
          poster_path = EXCLUDED.poster_path,
          backdrop_path = EXCLUDED.backdrop_path,
          runtime = EXCLUDED.runtime,
          episode_run_time = EXCLUDED.episode_run_time,
          number_of_seasons = EXCLUDED.number_of_seasons,
          number_of_episodes = EXCLUDED.number_of_episodes,
          external_ids = EXCLUDED.external_ids,
          raw = EXCLUDED.raw,
          fetched_at = EXCLUDED.fetched_at,
          expires_at = EXCLUDED.expires_at
      `,
      [
        record.mediaType,
        record.tmdbId,
        record.name,
        record.originalName,
        record.overview,
        record.releaseDate,
        record.firstAirDate,
        record.status,
        record.posterPath,
        record.backdropPath,
        record.runtime,
        JSON.stringify(record.episodeRunTime),
        record.numberOfSeasons,
        record.numberOfEpisodes,
        JSON.stringify(record.externalIds),
        JSON.stringify(record.raw),
        record.fetchedAt,
        record.expiresAt,
      ],
    );
  }

  async getSeason(client: DbClient, showTmdbId: number, seasonNumber: number): Promise<TmdbSeasonRecord | null> {
    const result = await client.query(
      `
        SELECT show_tmdb_id, season_number, name, overview, air_date, poster_path, episode_count, raw, fetched_at, expires_at
        FROM tmdb_tv_seasons
        WHERE show_tmdb_id = $1 AND season_number = $2
      `,
      [showTmdbId, seasonNumber],
    );

    return result.rows[0] ? mapSeason(result.rows[0]) : null;
  }

  async getEpisode(
    client: DbClient,
    showTmdbId: number,
    seasonNumber: number,
    episodeNumber: number,
  ): Promise<TmdbEpisodeRecord | null> {
    const result = await client.query(
      `
        SELECT show_tmdb_id, season_number, episode_number, tmdb_id, name, overview, air_date,
               runtime, still_path, vote_average, raw, fetched_at, expires_at
        FROM tmdb_tv_episodes
        WHERE show_tmdb_id = $1 AND season_number = $2 AND episode_number = $3
      `,
      [showTmdbId, seasonNumber, episodeNumber],
    );

    return result.rows[0] ? mapEpisode(result.rows[0]) : null;
  }

  async replaceSeasonEpisodes(client: DbClient, params: {
    showTmdbId: number;
    seasonNumber: number;
    seasonName: string | null;
    seasonOverview: string | null;
    airDate: string | null;
    posterPath: string | null;
    episodeCount: number | null;
    raw: Record<string, unknown>;
    episodes: TmdbEpisodeRecord[];
    fetchedAt: string;
    expiresAt: string;
  }): Promise<void> {
    await client.query(
      `
        INSERT INTO tmdb_tv_seasons (
          show_tmdb_id, season_number, name, overview, air_date, poster_path, episode_count, raw, fetched_at, expires_at
        )
        VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8::jsonb, $9::timestamptz, $10::timestamptz)
        ON CONFLICT (show_tmdb_id, season_number)
        DO UPDATE SET
          name = EXCLUDED.name,
          overview = EXCLUDED.overview,
          air_date = EXCLUDED.air_date,
          poster_path = EXCLUDED.poster_path,
          episode_count = EXCLUDED.episode_count,
          raw = EXCLUDED.raw,
          fetched_at = EXCLUDED.fetched_at,
          expires_at = EXCLUDED.expires_at
      `,
      [
        params.showTmdbId,
        params.seasonNumber,
        params.seasonName,
        params.seasonOverview,
        params.airDate,
        params.posterPath,
        params.episodeCount,
        JSON.stringify(params.raw),
        params.fetchedAt,
        params.expiresAt,
      ],
    );

    await client.query(`DELETE FROM tmdb_tv_episodes WHERE show_tmdb_id = $1 AND season_number = $2`, [params.showTmdbId, params.seasonNumber]);

    for (const episode of params.episodes) {
      await client.query(
        `
          INSERT INTO tmdb_tv_episodes (
            show_tmdb_id, season_number, episode_number, tmdb_id, name, overview, air_date,
            runtime, still_path, vote_average, raw, fetched_at, expires_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8, $9, $10, $11::jsonb, $12::timestamptz, $13::timestamptz)
        `,
        [
          episode.showTmdbId,
          episode.seasonNumber,
          episode.episodeNumber,
          episode.tmdbId,
          episode.name,
          episode.overview,
          episode.airDate,
          episode.runtime,
          episode.stillPath,
          episode.voteAverage,
          JSON.stringify(episode.raw),
          episode.fetchedAt,
          episode.expiresAt,
        ],
      );
    }
  }

  async listEpisodesForShow(client: DbClient, showTmdbId: number): Promise<TmdbEpisodeRecord[]> {
    const result = await client.query(
      `
        SELECT show_tmdb_id, season_number, episode_number, tmdb_id, name, overview, air_date,
               runtime, still_path, vote_average, raw, fetched_at, expires_at
        FROM tmdb_tv_episodes
        WHERE show_tmdb_id = $1
        ORDER BY season_number ASC, episode_number ASC
      `,
      [showTmdbId],
    );
    return result.rows.map((row) => mapEpisode(row));
  }

  async listEpisodesForSeason(client: DbClient, showTmdbId: number, seasonNumber: number): Promise<TmdbEpisodeRecord[]> {
    const result = await client.query(
      `
        SELECT show_tmdb_id, season_number, episode_number, tmdb_id, name, overview, air_date,
               runtime, still_path, vote_average, raw, fetched_at, expires_at
        FROM tmdb_tv_episodes
        WHERE show_tmdb_id = $1 AND season_number = $2
        ORDER BY episode_number ASC
      `,
      [showTmdbId, seasonNumber],
    );
    return result.rows.map((row) => mapEpisode(row));
  }
}
