import type { DbClient } from '../../lib/db.js';
import type { MediaIdentity } from './media-key.js';
import type { WatchMediaProjection } from './watch.types.js';

export class ContinueWatchingRepository {
  async upsert(client: DbClient, params: {
    profileId: string;
    identity: MediaIdentity;
    positionSeconds?: number | null;
    durationSeconds?: number | null;
    occurredAt: string;
    dismissedAt?: string | null;
    payload?: Record<string, unknown>;
    projection?: WatchMediaProjection;
  }): Promise<void> {
    const progressPercent =
      params.positionSeconds && params.durationSeconds && params.durationSeconds > 0
        ? Number(((params.positionSeconds / params.durationSeconds) * 100).toFixed(2))
        : 0;

    await client.query(
      `
        INSERT INTO continue_watching_projection (
          profile_id, media_key, media_type, tmdb_id, show_tmdb_id, season_number, episode_number,
          title, subtitle, poster_url, backdrop_url, position_seconds, duration_seconds,
          progress_percent, last_activity_at, dismissed_at, payload, updated_at
        )
        VALUES (
          $1::uuid, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12, $13,
          $14, $15::timestamptz, $16::timestamptz, $17::jsonb, now()
        )
        ON CONFLICT (profile_id, media_key)
        DO UPDATE SET
          title = COALESCE(continue_watching_projection.title, EXCLUDED.title),
          subtitle = COALESCE(continue_watching_projection.subtitle, EXCLUDED.subtitle),
          poster_url = COALESCE(continue_watching_projection.poster_url, EXCLUDED.poster_url),
          backdrop_url = COALESCE(continue_watching_projection.backdrop_url, EXCLUDED.backdrop_url),
          position_seconds = EXCLUDED.position_seconds,
          duration_seconds = EXCLUDED.duration_seconds,
          progress_percent = EXCLUDED.progress_percent,
          last_activity_at = EXCLUDED.last_activity_at,
          dismissed_at = EXCLUDED.dismissed_at,
          payload = EXCLUDED.payload,
          updated_at = now()
      `,
      [
        params.profileId,
        params.identity.mediaKey,
        params.identity.mediaType,
        params.identity.tmdbId,
        params.identity.showTmdbId,
        params.identity.seasonNumber,
        params.identity.episodeNumber,
        params.projection?.title ?? null,
        params.projection?.subtitle ?? null,
        params.projection?.posterUrl ?? null,
        params.projection?.backdropUrl ?? null,
        params.positionSeconds ?? 0,
        params.durationSeconds ?? null,
        progressPercent,
        params.occurredAt,
        params.dismissedAt ?? null,
        JSON.stringify(params.payload ?? {}),
      ],
    );
  }

  async delete(client: DbClient, profileId: string, mediaKey: string): Promise<void> {
    await client.query(
      `DELETE FROM continue_watching_projection WHERE profile_id = $1::uuid AND media_key = $2`,
      [profileId, mediaKey],
    );
  }

  async dismissById(client: DbClient, profileId: string, projectionId: string): Promise<void> {
    await client.query(
      `
        UPDATE continue_watching_projection
        SET dismissed_at = now(), updated_at = now()
        WHERE id = $1::uuid AND profile_id = $2::uuid
      `,
      [projectionId, profileId],
    );
  }

  async dismissByMediaKey(client: DbClient, profileId: string, mediaKey: string): Promise<void> {
    await client.query(
      `
        UPDATE continue_watching_projection
        SET dismissed_at = now(), updated_at = now()
        WHERE profile_id = $1::uuid AND media_key = $2
      `,
      [profileId, mediaKey],
    );
  }

  async list(client: DbClient, profileId: string, limit: number): Promise<Record<string, unknown>[]> {
    const result = await client.query(
      `
        SELECT id, media_key, media_type, tmdb_id, show_tmdb_id, season_number, episode_number,
               title, subtitle, poster_url, backdrop_url, position_seconds, duration_seconds,
               progress_percent, last_activity_at, payload
        FROM continue_watching_projection
        WHERE profile_id = $1::uuid AND dismissed_at IS NULL
        ORDER BY last_activity_at DESC
        LIMIT $2
      `,
      [profileId, limit],
    );
    return result.rows;
  }

  async getByMediaKey(client: DbClient, profileId: string, mediaKey: string): Promise<Record<string, unknown> | null> {
    const result = await client.query(
      `
        SELECT id, media_key, media_type, tmdb_id, show_tmdb_id, season_number, episode_number,
               position_seconds, duration_seconds, progress_percent, last_activity_at, payload
        FROM continue_watching_projection
        WHERE profile_id = $1::uuid AND media_key = $2 AND dismissed_at IS NULL
      `,
      [profileId, mediaKey],
    );
    return result.rows[0] ?? null;
  }

  async findById(client: DbClient, profileId: string, projectionId: string): Promise<Record<string, unknown> | null> {
    const result = await client.query(
      `
        SELECT id, media_key, media_type, tmdb_id, show_tmdb_id, season_number, episode_number,
               position_seconds, duration_seconds, progress_percent, last_activity_at, payload
        FROM continue_watching_projection
        WHERE id = $1::uuid AND profile_id = $2::uuid AND dismissed_at IS NULL
      `,
      [projectionId, profileId],
    );
    return result.rows[0] ?? null;
  }
}
