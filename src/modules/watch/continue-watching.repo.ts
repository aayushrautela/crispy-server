import type { DbClient } from '../../lib/db.js';
import { canonicalContinueWatchingMediaKey, parseMediaKey, type MediaIdentity } from '../identity/media-key.js';
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
    const canonicalMediaKey = canonicalContinueWatchingMediaKey(params.identity);
    const progressPercent =
      params.positionSeconds && params.durationSeconds && params.durationSeconds > 0
        ? Number(((params.positionSeconds / params.durationSeconds) * 100).toFixed(2))
        : 0;

    await client.query(
      `
        INSERT INTO continue_watching_projection (
          profile_id, canonical_media_key, media_key, media_type, tmdb_id, show_tmdb_id, season_number, episode_number,
          title, subtitle, poster_url, backdrop_url, position_seconds, duration_seconds,
          progress_percent, last_activity_at, dismissed_at, payload, updated_at
        )
        VALUES (
          $1::uuid, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13, $14,
          $15, $16::timestamptz, $17::timestamptz, $18::jsonb, now()
        )
        ON CONFLICT (profile_id, canonical_media_key)
        DO UPDATE SET
          media_key = EXCLUDED.media_key,
          media_type = EXCLUDED.media_type,
          tmdb_id = EXCLUDED.tmdb_id,
          show_tmdb_id = EXCLUDED.show_tmdb_id,
          season_number = EXCLUDED.season_number,
          episode_number = EXCLUDED.episode_number,
          title = COALESCE(EXCLUDED.title, continue_watching_projection.title),
          subtitle = COALESCE(EXCLUDED.subtitle, continue_watching_projection.subtitle),
          poster_url = COALESCE(EXCLUDED.poster_url, continue_watching_projection.poster_url),
          backdrop_url = COALESCE(EXCLUDED.backdrop_url, continue_watching_projection.backdrop_url),
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
        canonicalMediaKey,
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
    const identity = parseMediaKey(mediaKey);
    const canonicalMediaKey = canonicalContinueWatchingMediaKey(identity);
    await client.query(
      `
        DELETE FROM continue_watching_projection
        WHERE profile_id = $1::uuid
          AND canonical_media_key = $2
          AND ($3 = 'show' OR $3 = 'movie' OR media_key = $4)
      `,
      [profileId, canonicalMediaKey, identity.mediaType, identity.mediaKey],
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
    const identity = parseMediaKey(mediaKey);
    const canonicalMediaKey = canonicalContinueWatchingMediaKey(identity);
    await client.query(
      `
        UPDATE continue_watching_projection
        SET dismissed_at = now(), updated_at = now()
        WHERE profile_id = $1::uuid
          AND canonical_media_key = $2
          AND ($3 = 'show' OR $3 = 'movie' OR media_key = $4)
      `,
      [profileId, canonicalMediaKey, identity.mediaType, identity.mediaKey],
    );
  }

  async list(client: DbClient, profileId: string, limit: number): Promise<Record<string, unknown>[]> {
    const result = await client.query(
      `
        SELECT id, canonical_media_key, media_key, media_type, tmdb_id, show_tmdb_id, season_number, episode_number,
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
    const identity = parseMediaKey(mediaKey);
    const canonicalMediaKey = canonicalContinueWatchingMediaKey(identity);
    const result = await client.query(
      `
        SELECT id, canonical_media_key, media_key, media_type, tmdb_id, show_tmdb_id, season_number, episode_number,
               position_seconds, duration_seconds, progress_percent, last_activity_at, payload
        FROM continue_watching_projection
        WHERE profile_id = $1::uuid AND canonical_media_key = $2 AND dismissed_at IS NULL
      `,
      [profileId, canonicalMediaKey],
    );
    return result.rows[0] ?? null;
  }

  async findById(client: DbClient, profileId: string, projectionId: string): Promise<Record<string, unknown> | null> {
    const result = await client.query(
      `
        SELECT id, canonical_media_key, media_key, media_type, tmdb_id, show_tmdb_id, season_number, episode_number,
               position_seconds, duration_seconds, progress_percent, last_activity_at, payload
        FROM continue_watching_projection
        WHERE id = $1::uuid AND profile_id = $2::uuid AND dismissed_at IS NULL
      `,
      [projectionId, profileId],
    );
    return result.rows[0] ?? null;
  }
}
