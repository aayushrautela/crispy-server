import type { DbClient } from '../../lib/db.js';
import { deriveProgressPercent } from './heartbeat-policy.js';
import type { MediaIdentity } from './media-key.js';
import type { WatchMediaProjection } from './watch.types.js';
import type { WatchEventInput } from './watch.types.js';

export type PersistedWatchEvent = {
  id: string;
  profileId: string;
  profileGroupId: string;
  eventType: string;
  mediaKey: string;
  occurredAt: string;
};

export type RebuildableWatchEvent = PersistedWatchEvent & {
  mediaType: string;
  tmdbId: number | null;
  showTmdbId: number | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  title: string | null;
  subtitle: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  positionSeconds: number | null;
  durationSeconds: number | null;
  rating: number | null;
  payload: Record<string, unknown>;
};

export class WatchEventsRepository {
  async insert(client: DbClient, params: {
    profileGroupId: string;
    profileId: string;
    input: WatchEventInput;
    identity: MediaIdentity;
    projection?: WatchMediaProjection;
  }): Promise<PersistedWatchEvent> {
    const result = await client.query(
      `
        INSERT INTO watch_events (
          profile_group_id,
          profile_id,
          client_event_id,
          event_type,
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
          rating,
          occurred_at,
          payload
        )
        VALUES (
          $1::uuid,
          $2::uuid,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
           $11,
           $12,
           $13,
           $14,
           $15,
           $16,
           $17,
           $18,
           $19::timestamptz,
           $20::jsonb
        )
        ON CONFLICT (profile_id, client_event_id)
        DO UPDATE SET occurred_at = EXCLUDED.occurred_at
        RETURNING id, profile_id, profile_group_id, event_type, media_key, occurred_at
      `,
      [
        params.profileGroupId,
        params.profileId,
        params.input.clientEventId,
        params.input.eventType,
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
         params.input.positionSeconds ?? null,
         params.input.durationSeconds ?? null,
         deriveProgressPercent(params.input.positionSeconds, params.input.durationSeconds),
         params.input.rating ?? null,
         params.input.occurredAt ?? new Date().toISOString(),
         JSON.stringify(params.input.payload ?? {}),
       ],
     );

    return {
      id: String(result.rows[0].id),
      profileId: String(result.rows[0].profile_id),
      profileGroupId: String(result.rows[0].profile_group_id),
      eventType: String(result.rows[0].event_type),
      mediaKey: String(result.rows[0].media_key),
      occurredAt: String(result.rows[0].occurred_at),
    };
  }

  async listForProfile(client: DbClient, profileId: string): Promise<RebuildableWatchEvent[]> {
    const result = await client.query(
      `
        SELECT id, profile_id, profile_group_id, event_type, media_key, media_type,
               tmdb_id, show_tmdb_id, season_number, episode_number,
               title, subtitle, poster_url, backdrop_url,
               position_seconds, duration_seconds, rating, occurred_at, payload
        FROM watch_events
        WHERE profile_id = $1::uuid
        ORDER BY occurred_at ASC, created_at ASC, id ASC
      `,
      [profileId],
    );

    return result.rows.map((row) => ({
      id: String(row.id),
      profileId: String(row.profile_id),
      profileGroupId: String(row.profile_group_id),
      eventType: String(row.event_type),
      mediaKey: String(row.media_key),
      mediaType: String(row.media_type),
      tmdbId: row.tmdb_id === null ? null : Number(row.tmdb_id),
      showTmdbId: row.show_tmdb_id === null ? null : Number(row.show_tmdb_id),
      seasonNumber: row.season_number === null ? null : Number(row.season_number),
      episodeNumber: row.episode_number === null ? null : Number(row.episode_number),
      title: typeof row.title === 'string' ? row.title : null,
      subtitle: typeof row.subtitle === 'string' ? row.subtitle : null,
      posterUrl: typeof row.poster_url === 'string' ? row.poster_url : null,
      backdropUrl: typeof row.backdrop_url === 'string' ? row.backdrop_url : null,
      positionSeconds: row.position_seconds === null ? null : Number(row.position_seconds),
      durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
      rating: row.rating === null ? null : Number(row.rating),
      occurredAt: String(row.occurred_at),
      payload: (row.payload as Record<string, unknown> | undefined) ?? {},
    }));
  }
}
