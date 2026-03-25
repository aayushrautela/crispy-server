import type { DbClient } from '../../lib/db.js';
import type { MediaIdentity } from './media-key.js';

export class WatchHistoryRepository {
  async upsertWatched(client: DbClient, params: {
    profileId: string;
    identity: MediaIdentity;
    watchedAt: string;
    sourceEventId: string;
    payload?: Record<string, unknown>;
  }): Promise<void> {
    await client.query(
      `
        INSERT INTO watch_history (
          profile_id,
          media_key,
          media_type,
          tmdb_id,
          show_tmdb_id,
          season_number,
          episode_number,
          title,
          subtitle,
          poster_url,
          backdrop_url,
          watched_at,
          source_event_id,
          payload
        )
        VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, NULL, NULL, NULL, NULL, $8::timestamptz, $9::uuid, $10::jsonb)
        ON CONFLICT (profile_id, media_key)
        DO UPDATE SET
          title = COALESCE(watch_history.title, EXCLUDED.title),
          subtitle = COALESCE(watch_history.subtitle, EXCLUDED.subtitle),
          poster_url = COALESCE(watch_history.poster_url, EXCLUDED.poster_url),
          backdrop_url = COALESCE(watch_history.backdrop_url, EXCLUDED.backdrop_url),
          watched_at = EXCLUDED.watched_at,
          source_event_id = EXCLUDED.source_event_id,
          payload = EXCLUDED.payload
      `,
      [
        params.profileId,
        params.identity.mediaKey,
        params.identity.mediaType,
        params.identity.tmdbId,
        params.identity.showTmdbId,
        params.identity.seasonNumber,
        params.identity.episodeNumber,
        params.watchedAt,
        params.sourceEventId,
        JSON.stringify(params.payload ?? {}),
      ],
    );
  }

  async deleteWatched(client: DbClient, profileId: string, mediaKey: string): Promise<void> {
    await client.query(
      `DELETE FROM watch_history WHERE profile_id = $1::uuid AND media_key = $2`,
      [profileId, mediaKey],
    );
  }

  async list(client: DbClient, profileId: string, limit: number): Promise<Record<string, unknown>[]> {
    const result = await client.query(
      `
        SELECT media_key, media_type, tmdb_id, show_tmdb_id, season_number, episode_number,
               title, subtitle, poster_url, backdrop_url, watched_at, payload
        FROM watch_history
        WHERE profile_id = $1::uuid
        ORDER BY watched_at DESC
        LIMIT $2
      `,
      [profileId, limit],
    );
    return result.rows;
  }

  async getByMediaKey(client: DbClient, profileId: string, mediaKey: string): Promise<Record<string, unknown> | null> {
    const result = await client.query(
      `
        SELECT media_key, media_type, tmdb_id, show_tmdb_id, season_number, episode_number, watched_at, payload
        FROM watch_history
        WHERE profile_id = $1::uuid AND media_key = $2
      `,
      [profileId, mediaKey],
    );
    return result.rows[0] ?? null;
  }

  async listWatchedEpisodeKeys(client: DbClient, profileId: string, showTmdbId: number): Promise<Set<string>> {
    const result = await client.query(
      `
        SELECT season_number, episode_number
        FROM watch_history
        WHERE profile_id = $1::uuid
          AND media_type = 'episode'
          AND show_tmdb_id = $2
      `,
      [profileId, showTmdbId],
    );
    return new Set(
      result.rows.map((row) => `episode:tmdb:${showTmdbId}:${Number(row.season_number)}:${Number(row.episode_number)}`),
    );
  }
}
