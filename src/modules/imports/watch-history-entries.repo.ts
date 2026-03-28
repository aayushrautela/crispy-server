import type { DbClient } from '../../lib/db.js';
import { requireDbIsoString } from '../../lib/time.js';

export type WatchHistoryEntryRecord = {
  id: string;
  profileId: string;
  profileGroupId: string;
  mediaKey: string;
  mediaType: string;
  provider: string | null;
  providerId: string | null;
  parentProvider: string | null;
  parentProviderId: string | null;
  tmdbId: number | null;
  showTmdbId: number | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  absoluteEpisodeNumber: number | null;
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
    profileGroupId: String(row.profile_group_id),
    mediaKey: String(row.media_key),
    mediaType: String(row.media_type),
    provider: typeof row.provider === 'string' ? row.provider : null,
    providerId: typeof row.provider_id === 'string' ? row.provider_id : null,
    parentProvider: typeof row.parent_provider === 'string' ? row.parent_provider : null,
    parentProviderId: typeof row.parent_provider_id === 'string' ? row.parent_provider_id : null,
    tmdbId: row.tmdb_id === null ? null : Number(row.tmdb_id),
    showTmdbId: row.show_tmdb_id === null ? null : Number(row.show_tmdb_id),
    seasonNumber: row.season_number === null ? null : Number(row.season_number),
    episodeNumber: row.episode_number === null ? null : Number(row.episode_number),
    absoluteEpisodeNumber: row.absolute_episode_number === null ? null : Number(row.absolute_episode_number),
    watchedAt: requireDbIsoString(row.watched_at as Date | string | null | undefined, 'watch_history_entries.watched_at'),
    sourceWatchEventId: typeof row.source_watch_event_id === 'string' ? row.source_watch_event_id : null,
    sourceKind: String(row.source_kind),
    payload: (row.payload as Record<string, unknown> | undefined) ?? {},
    createdAt: requireDbIsoString(row.created_at as Date | string | null | undefined, 'watch_history_entries.created_at'),
  };
}

export class WatchHistoryEntriesRepository {
  async clearForProfile(client: DbClient, profileId: string): Promise<void> {
    await client.query(`DELETE FROM watch_history_entries WHERE profile_id = $1::uuid`, [profileId]);
  }

  async append(client: DbClient, params: {
    profileId: string;
    profileGroupId: string;
    mediaKey: string;
    mediaType: string;
    provider?: string | null;
    providerId?: string | null;
    parentProvider?: string | null;
    parentProviderId?: string | null;
    tmdbId?: number | null;
    showTmdbId?: number | null;
    seasonNumber?: number | null;
    episodeNumber?: number | null;
    absoluteEpisodeNumber?: number | null;
    watchedAt: string;
    sourceWatchEventId?: string | null;
    sourceKind: string;
    payload?: Record<string, unknown>;
  }): Promise<WatchHistoryEntryRecord> {
    const result = await client.query(
      `
        INSERT INTO watch_history_entries (
          profile_id,
          profile_group_id,
          media_key,
          media_type,
          provider,
          provider_id,
          parent_provider,
          parent_provider_id,
          tmdb_id,
          show_tmdb_id,
          season_number,
          episode_number,
          absolute_episode_number,
          watched_at,
          source_watch_event_id,
          source_kind,
          payload
        )
        VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::timestamptz, $14::uuid, $15, $16::jsonb)
        RETURNING id, profile_id, profile_group_id, media_key, media_type,
                  provider, provider_id, parent_provider, parent_provider_id,
                  tmdb_id, show_tmdb_id, season_number, episode_number, absolute_episode_number,
                  watched_at, source_watch_event_id, source_kind, payload, created_at
      `,
      [
        params.profileId,
        params.profileGroupId,
        params.mediaKey,
        params.mediaType,
        params.provider ?? null,
        params.providerId ?? null,
        params.parentProvider ?? null,
        params.parentProviderId ?? null,
        params.tmdbId ?? null,
        params.showTmdbId ?? null,
        params.seasonNumber ?? null,
        params.episodeNumber ?? null,
        params.absoluteEpisodeNumber ?? null,
        params.watchedAt,
        params.sourceWatchEventId ?? null,
        params.sourceKind,
        JSON.stringify(params.payload ?? {}),
      ],
    );
    return mapEntry(result.rows[0]);
  }
}
