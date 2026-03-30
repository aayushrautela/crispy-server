import type { DbClient } from '../../lib/db.js';
import { requireDbIsoString, toDbIsoString } from '../../lib/time.js';
import type { SupportedProvider } from '../identity/media-key.js';

export type TrackedSeriesRecord = {
  profileId: string;
  trackedMediaKey: string;
  trackedMediaType: 'show' | 'anime';
  provider: SupportedProvider;
  providerId: string;
  showTmdbId: number | null;
  reason: string;
  lastSourceEventId: string | null;
  lastInteractedAt: string;
  nextEpisodeAirDate: string | null;
  metadataRefreshedAt: string | null;
  payload: Record<string, unknown>;
};

function mapTrackedSeries(row: Record<string, unknown>): TrackedSeriesRecord {
  const trackedMediaType = String(row.tracked_media_type);
  const provider = String(row.provider);
  return {
    profileId: String(row.profile_id),
    trackedMediaKey: String(row.tracked_media_key),
    trackedMediaType: trackedMediaType === 'anime' ? 'anime' : 'show',
    provider: provider === 'tvdb' || provider === 'kitsu' ? provider : 'tmdb',
    providerId: String(row.provider_id),
    showTmdbId: row.show_tmdb_id === null ? null : Number(row.show_tmdb_id),
    reason: String(row.reason),
    lastSourceEventId: typeof row.last_source_event_id === 'string' ? row.last_source_event_id : null,
    lastInteractedAt: requireDbIsoString(row.last_interacted_at as Date | string | null | undefined, 'profile_tracked_series.last_interacted_at'),
    nextEpisodeAirDate: toDbIsoString(row.next_episode_air_date as Date | string | null | undefined, 'profile_tracked_series.next_episode_air_date'),
    metadataRefreshedAt: toDbIsoString(row.metadata_refreshed_at as Date | string | null | undefined, 'profile_tracked_series.metadata_refreshed_at'),
    payload: (row.payload as Record<string, unknown> | undefined) ?? {},
  };
}

export class TrackedSeriesRepository {
  async upsert(client: DbClient, params: {
    profileId: string;
    trackedMediaKey: string;
    trackedMediaType: 'show' | 'anime';
    provider: SupportedProvider;
    providerId: string;
    showTmdbId?: number | null;
    reason: string;
    lastSourceEventId?: string | null;
    lastInteractedAt: string;
    payload?: Record<string, unknown>;
  }): Promise<void> {
    await client.query(
      `
        INSERT INTO profile_tracked_series (
          profile_id,
          tracked_media_key,
          tracked_media_type,
          provider,
          provider_id,
          show_tmdb_id,
          reason,
          last_source_event_id,
          last_interacted_at,
          payload
        )
        VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8::uuid, $9::timestamptz, $10::jsonb)
        ON CONFLICT (profile_id, tracked_media_key)
        DO UPDATE SET
          tracked_media_type = EXCLUDED.tracked_media_type,
          provider = EXCLUDED.provider,
          provider_id = EXCLUDED.provider_id,
          show_tmdb_id = EXCLUDED.show_tmdb_id,
          reason = EXCLUDED.reason,
          last_source_event_id = EXCLUDED.last_source_event_id,
          last_interacted_at = EXCLUDED.last_interacted_at,
          payload = profile_tracked_series.payload || EXCLUDED.payload
      `,
      [
        params.profileId,
        params.trackedMediaKey,
        params.trackedMediaType,
        params.provider,
        params.providerId,
        params.showTmdbId ?? null,
        params.reason,
        params.lastSourceEventId ?? null,
        params.lastInteractedAt,
        JSON.stringify(params.payload ?? {}),
      ],
    );
  }

  async listForProfile(client: DbClient, profileId: string, limit: number): Promise<TrackedSeriesRecord[]> {
    const result = await client.query(
        `
        SELECT profile_id, tracked_media_key, tracked_media_type, provider, provider_id,
               show_tmdb_id, reason, last_source_event_id, last_interacted_at,
               next_episode_air_date, metadata_refreshed_at, payload
        FROM profile_tracked_series
        WHERE profile_id = $1::uuid
        ORDER BY COALESCE(next_episode_air_date, DATE '9999-12-31') ASC, last_interacted_at DESC
        LIMIT $2
      `,
      [profileId, limit],
    );
    return result.rows.map((row) => mapTrackedSeries(row));
  }

  async updateMetadataState(client: DbClient, params: {
    profileId: string;
    trackedMediaKey: string;
    nextEpisodeAirDate?: string | null;
    metadataRefreshedAt: string;
  }): Promise<void> {
    await client.query(
      `
        UPDATE profile_tracked_series
        SET
          next_episode_air_date = $3::date,
          metadata_refreshed_at = $4::timestamptz
        WHERE profile_id = $1::uuid AND tracked_media_key = $2
      `,
      [params.profileId, params.trackedMediaKey, params.nextEpisodeAirDate ?? null, params.metadataRefreshedAt],
    );
  }
}
