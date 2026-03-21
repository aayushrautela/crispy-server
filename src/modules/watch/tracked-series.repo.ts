import type { DbClient } from '../../lib/db.js';

export type TrackedSeriesRecord = {
  profileId: string;
  showTmdbId: number;
  reason: string;
  lastSourceEventId: string | null;
  lastInteractedAt: string;
  nextEpisodeAirDate: string | null;
  metadataRefreshedAt: string | null;
  payload: Record<string, unknown>;
};

function mapTrackedSeries(row: Record<string, unknown>): TrackedSeriesRecord {
  return {
    profileId: String(row.profile_id),
    showTmdbId: Number(row.show_tmdb_id),
    reason: String(row.reason),
    lastSourceEventId: typeof row.last_source_event_id === 'string' ? row.last_source_event_id : null,
    lastInteractedAt: String(row.last_interacted_at),
    nextEpisodeAirDate: row.next_episode_air_date ? String(row.next_episode_air_date) : null,
    metadataRefreshedAt: row.metadata_refreshed_at ? String(row.metadata_refreshed_at) : null,
    payload: (row.payload as Record<string, unknown> | undefined) ?? {},
  };
}

export class TrackedSeriesRepository {
  async upsert(client: DbClient, params: {
    profileId: string;
    showTmdbId: number;
    reason: string;
    lastSourceEventId?: string | null;
    lastInteractedAt: string;
    payload?: Record<string, unknown>;
  }): Promise<void> {
    await client.query(
      `
        INSERT INTO profile_tracked_series (
          profile_id,
          show_tmdb_id,
          reason,
          last_source_event_id,
          last_interacted_at,
          payload
        )
        VALUES ($1::uuid, $2, $3, $4::uuid, $5::timestamptz, $6::jsonb)
        ON CONFLICT (profile_id, show_tmdb_id)
        DO UPDATE SET
          reason = EXCLUDED.reason,
          last_source_event_id = EXCLUDED.last_source_event_id,
          last_interacted_at = EXCLUDED.last_interacted_at,
          payload = profile_tracked_series.payload || EXCLUDED.payload
      `,
      [
        params.profileId,
        params.showTmdbId,
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
        SELECT profile_id, show_tmdb_id, reason, last_source_event_id, last_interacted_at,
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
    showTmdbId: number;
    nextEpisodeAirDate?: string | null;
    metadataRefreshedAt: string;
  }): Promise<void> {
    await client.query(
      `
        UPDATE profile_tracked_series
        SET
          next_episode_air_date = $3::date,
          metadata_refreshed_at = $4::timestamptz
        WHERE profile_id = $1::uuid AND show_tmdb_id = $2
      `,
      [params.profileId, params.showTmdbId, params.nextEpisodeAirDate ?? null, params.metadataRefreshedAt],
    );
  }
}
