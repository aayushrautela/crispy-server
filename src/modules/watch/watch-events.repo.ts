import type { DbClient } from '../../lib/db.js';
import type { MediaIdentity } from './media-key.js';
import type { WatchEventInput } from './watch.types.js';

export type PersistedWatchEvent = {
  id: string;
  profileId: string;
  householdId: string;
  eventType: string;
  mediaKey: string;
  occurredAt: string;
};

export class WatchEventsRepository {
  async insert(client: DbClient, params: {
    householdId: string;
    profileId: string;
    input: WatchEventInput;
    identity: MediaIdentity;
  }): Promise<PersistedWatchEvent> {
    const result = await client.query(
      `
        INSERT INTO watch_events (
          household_id,
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
        RETURNING id, profile_id, household_id, event_type, media_key, occurred_at
      `,
      [
        params.householdId,
        params.profileId,
        params.input.clientEventId,
        params.input.eventType,
        params.identity.mediaKey,
        params.identity.mediaType,
        params.identity.tmdbId,
        params.identity.showTmdbId,
        params.identity.seasonNumber,
        params.identity.episodeNumber,
        params.input.title ?? null,
        params.input.subtitle ?? null,
        params.input.posterUrl ?? null,
        params.input.backdropUrl ?? null,
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
      householdId: String(result.rows[0].household_id),
      eventType: String(result.rows[0].event_type),
      mediaKey: String(result.rows[0].media_key),
      occurredAt: String(result.rows[0].occurred_at),
    };
  }
}

function deriveProgressPercent(positionSeconds?: number | null, durationSeconds?: number | null): number | null {
  if (!positionSeconds || !durationSeconds || durationSeconds <= 0) {
    return null;
  }
  return Math.max(0, Math.min(100, Number(((positionSeconds / durationSeconds) * 100).toFixed(2))));
}
