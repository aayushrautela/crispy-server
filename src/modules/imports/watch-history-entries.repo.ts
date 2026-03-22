import type { DbClient } from '../../lib/db.js';

export type WatchHistoryEntryRecord = {
  id: string;
  profileId: string;
  householdId: string;
  mediaKey: string;
  mediaType: string;
  tmdbId: number | null;
  showTmdbId: number | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  watchedAt: string;
  sourceWatchEventId: string | null;
  sourceKind: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

function mapEntry(row: Record<string, unknown>): WatchHistoryEntryRecord {
  return {
    id: String(row.id),
    profileId: String(row.profile_id),
    householdId: String(row.household_id),
    mediaKey: String(row.media_key),
    mediaType: String(row.media_type),
    tmdbId: row.tmdb_id === null ? null : Number(row.tmdb_id),
    showTmdbId: row.show_tmdb_id === null ? null : Number(row.show_tmdb_id),
    seasonNumber: row.season_number === null ? null : Number(row.season_number),
    episodeNumber: row.episode_number === null ? null : Number(row.episode_number),
    watchedAt: String(row.watched_at),
    sourceWatchEventId: typeof row.source_watch_event_id === 'string' ? row.source_watch_event_id : null,
    sourceKind: String(row.source_kind),
    payload: (row.payload as Record<string, unknown> | undefined) ?? {},
    createdAt: String(row.created_at),
  };
}

export class WatchHistoryEntriesRepository {
  async append(client: DbClient, params: {
    profileId: string;
    householdId: string;
    mediaKey: string;
    mediaType: string;
    tmdbId?: number | null;
    showTmdbId?: number | null;
    seasonNumber?: number | null;
    episodeNumber?: number | null;
    watchedAt: string;
    sourceWatchEventId?: string | null;
    sourceKind: string;
    payload?: Record<string, unknown>;
  }): Promise<WatchHistoryEntryRecord> {
    const result = await client.query(
      `
        INSERT INTO watch_history_entries (
          profile_id,
          household_id,
          media_key,
          media_type,
          tmdb_id,
          show_tmdb_id,
          season_number,
          episode_number,
          watched_at,
          source_watch_event_id,
          source_kind,
          payload
        )
        VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10::uuid, $11, $12::jsonb)
        RETURNING id, profile_id, household_id, media_key, media_type, tmdb_id, show_tmdb_id,
                  season_number, episode_number, watched_at, source_watch_event_id, source_kind, payload, created_at
      `,
      [
        params.profileId,
        params.householdId,
        params.mediaKey,
        params.mediaType,
        params.tmdbId ?? null,
        params.showTmdbId ?? null,
        params.seasonNumber ?? null,
        params.episodeNumber ?? null,
        params.watchedAt,
        params.sourceWatchEventId ?? null,
        params.sourceKind,
        JSON.stringify(params.payload ?? {}),
      ],
    );
    return mapEntry(result.rows[0]);
  }
}
