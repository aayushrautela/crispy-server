import type { DbClient } from '../../lib/db.js';
import type { PersistedProgressSnapshot } from './heartbeat-policy.js';
import type { MediaIdentity } from './media-key.js';

export class MediaProgressRepository {
  async upsert(client: DbClient, params: {
    profileId: string;
    identity: MediaIdentity;
    eventId: string;
    positionSeconds?: number | null;
    durationSeconds?: number | null;
    occurredAt: string;
    status: string;
    dismissedAt?: string | null;
    payload?: Record<string, unknown>;
  }): Promise<void> {
    const progressPercent =
      params.positionSeconds && params.durationSeconds && params.durationSeconds > 0
        ? Number(((params.positionSeconds / params.durationSeconds) * 100).toFixed(2))
        : 0;

    await client.query(
      `
        INSERT INTO media_progress (
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
          position_seconds,
          duration_seconds,
          progress_percent,
          status,
          last_event_id,
          last_played_at,
          completed_at,
          dismissed_at,
          payload,
          updated_at
        )
        VALUES (
          $1::uuid, $2, $3, $4, $5, $6, $7, NULL, NULL, NULL, NULL,
          $8, $9, $10, $11, $12::uuid, $13::timestamptz,
          CASE WHEN $11 = 'completed' THEN $13::timestamptz ELSE NULL END,
          $14::timestamptz,
          $15::jsonb,
          now()
        )
        ON CONFLICT (profile_id, media_key)
        DO UPDATE SET
          title = COALESCE(media_progress.title, EXCLUDED.title),
          subtitle = COALESCE(media_progress.subtitle, EXCLUDED.subtitle),
          poster_url = COALESCE(media_progress.poster_url, EXCLUDED.poster_url),
          backdrop_url = COALESCE(media_progress.backdrop_url, EXCLUDED.backdrop_url),
          position_seconds = EXCLUDED.position_seconds,
          duration_seconds = EXCLUDED.duration_seconds,
          progress_percent = EXCLUDED.progress_percent,
          status = EXCLUDED.status,
          last_event_id = EXCLUDED.last_event_id,
          last_played_at = EXCLUDED.last_played_at,
          completed_at = EXCLUDED.completed_at,
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
        params.positionSeconds ?? 0,
        params.durationSeconds ?? null,
        progressPercent,
        params.status,
        params.eventId,
        params.occurredAt,
        params.dismissedAt ?? null,
        JSON.stringify(params.payload ?? {}),
      ],
    );
  }

  async dismissContinueWatching(client: DbClient, profileId: string, mediaKey: string): Promise<void> {
    await client.query(
      `
        UPDATE media_progress
        SET dismissed_at = now(), updated_at = now()
        WHERE profile_id = $1::uuid AND media_key = $2
      `,
      [profileId, mediaKey],
    );
  }

  async getByMediaKey(client: DbClient, profileId: string, mediaKey: string): Promise<PersistedProgressSnapshot | null> {
    const result = await client.query(
      `
        SELECT position_seconds, duration_seconds, progress_percent, status, last_played_at
        FROM media_progress
        WHERE profile_id = $1::uuid AND media_key = $2
      `,
      [profileId, mediaKey],
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      positionSeconds: Number(row.position_seconds ?? 0),
      durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
      progressPercent: Number(row.progress_percent ?? 0),
      status: String(row.status),
      lastPlayedAt: String(row.last_played_at),
    };
  }
}
