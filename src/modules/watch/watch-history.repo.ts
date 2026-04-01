import { parseMediaKey } from '../identity/media-key.js';
import type { DbClient } from '../../lib/db.js';
import type { MediaIdentity } from '../identity/media-key.js';
import { buildTitleDedupedPageQuery } from './title-deduped-page-query.js';

export class WatchHistoryRepository {
  async upsertWatched(client: DbClient, params: {
    profileId: string;
    identity: MediaIdentity;
    watchedAt: string;
    sourceEventId: string;
    payload?: Record<string, unknown>;
  }): Promise<void> {
    await client.query(
      `
        INSERT INTO watch_history_latest (
          profile_id,
          media_key,
          media_type,
          tmdb_id,
          show_tmdb_id,
          season_number,
          episode_number,
          watched_at,
          source_event_id,
          payload
        )
        VALUES (
          $1::uuid, $2, $3, $4, $5, $6, $7,
          $8::timestamptz, $9::uuid, $10::jsonb
        )
        ON CONFLICT (profile_id, media_key)
        DO UPDATE SET
          watched_at = EXCLUDED.watched_at,
          source_event_id = EXCLUDED.source_event_id,
          payload = EXCLUDED.payload
      `,
      [
        params.profileId,
        params.identity.mediaKey,
        params.identity.mediaType,
        params.identity.tmdbId,
        params.identity.showTmdbId,
        params.identity.seasonNumber,
        params.identity.episodeNumber,
        params.watchedAt,
        params.sourceEventId,
        JSON.stringify(params.payload ?? {}),
      ],
    );
  }

  async deleteWatched(client: DbClient, profileId: string, mediaKey: string): Promise<void> {
    await client.query(
      `DELETE FROM watch_history_latest WHERE profile_id = $1::uuid AND media_key = $2`,
      [profileId, mediaKey],
    );
  }

  async list(client: DbClient, profileId: string, limit: number): Promise<Record<string, unknown>[]> {
    const page = await this.listPage(client, profileId, limit, null);
    return page.rows;
  }

  async listPage(client: DbClient, profileId: string, limit: number, cursor: { sortValue: string; tieBreaker: string } | null): Promise<{
    rows: Record<string, unknown>[];
    hasMore: boolean;
  }> {
    const result = await client.query(
      buildTitleDedupedPageQuery({
        tableName: 'watch_history_latest',
        sortColumn: 'watched_at',
        extraColumns: ['show_tmdb_id', 'season_number', 'episode_number'],
      }),
      [profileId, cursor?.sortValue ?? null, cursor?.tieBreaker ?? null, limit + 1],
    );
    const rows = result.rows.slice(0, limit);
    return { rows, hasMore: result.rows.length > limit };
  }

  async getByMediaKey(client: DbClient, profileId: string, mediaKey: string): Promise<Record<string, unknown> | null> {
    const result = await client.query(
      `
        SELECT media_key, media_type, tmdb_id, show_tmdb_id, season_number, episode_number,
               watched_at, payload
        FROM watch_history_latest
        WHERE profile_id = $1::uuid AND media_key = $2
      `,
      [profileId, mediaKey],
    );
    return result.rows[0] ?? null;
  }

  async listWatchedEpisodeKeys(client: DbClient, profileId: string, showTmdbId: number): Promise<Set<string>> {
    const result = await client.query(
      `
        SELECT season_number, episode_number
        FROM watch_history_latest
        WHERE profile_id = $1::uuid
          AND media_type = 'episode'
          AND show_tmdb_id = $2
      `,
      [profileId, showTmdbId],
    );
    return new Set(
      result.rows.map((row) => `episode:tmdb:${showTmdbId}:${Number(row.season_number)}:${Number(row.episode_number)}`),
    );
  }

  async listWatchedEpisodeKeysForTrackedMedia(client: DbClient, profileId: string, trackedMediaKey: string): Promise<Set<string>> {
    const trackedIdentity = parseMediaKey(trackedMediaKey);
    if (trackedIdentity.mediaType !== 'show' && trackedIdentity.mediaType !== 'anime') {
      return new Set();
    }

    const prefix = `episode:${trackedIdentity.provider}:${trackedIdentity.providerId}:`;
    const result = await client.query(
      `
        SELECT media_key
        FROM watch_history_latest
        WHERE profile_id = $1::uuid
          AND media_type = 'episode'
          AND media_key LIKE $2
      `,
      [profileId, `${prefix}%`],
    );

    return new Set(
      result.rows
        .map((row) => (typeof row.media_key === 'string' ? row.media_key : null))
        .filter((value): value is string => Boolean(value)),
    );
  }
}
