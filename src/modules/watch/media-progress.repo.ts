import type { DbClient } from '../../lib/db.js';
import type { MediaIdentity } from './media-key.js';

export class MediaProgressRepository {
  async upsert(client: DbClient, params: {
    profileId: string;
    identity: MediaIdentity;
    eventId: string;
    title?: string | null;
    subtitle?: string | null;
    posterUrl?: string | null;
    backdropUrl?: string | null;
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
          $1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
          $12, $13, $14, $15, $16::uuid, $17::timestamptz,
          CASE WHEN $15 = 'completed' THEN $17::timestamptz ELSE NULL END,
          $18::timestamptz,
          $19::jsonb,
          now()
        )
        ON CONFLICT (profile_id, media_key)
        DO UPDATE SET
          title = EXCLUDED.title,
          subtitle = EXCLUDED.subtitle,
          poster_url = EXCLUDED.poster_url,
          backdrop_url = EXCLUDED.backdrop_url,
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
        params.title ?? null,
        params.subtitle ?? null,
        params.posterUrl ?? null,
        params.backdropUrl ?? null,
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
}
