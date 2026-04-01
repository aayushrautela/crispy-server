import type { DbClient } from '../../lib/db.js';
import type { MediaIdentity } from '../identity/media-key.js';
import { buildTitleDedupedPageQuery } from './title-deduped-page-query.js';
export class WatchlistRepository {
  async put(client: DbClient, params: {
    profileId: string;
    identity: MediaIdentity;
    sourceEventId: string;
    addedAt: string;
    payload?: Record<string, unknown>;
  }): Promise<void> {
    await client.query(
      `
        INSERT INTO watchlist_items (
          profile_id, media_key, media_type, tmdb_id, added_at, source_event_id, payload
        )
         VALUES (
           $1::uuid, $2, $3, $4, $5::timestamptz, $6::uuid, $7::jsonb
         )
        ON CONFLICT (profile_id, media_key)
        DO UPDATE SET
          added_at = EXCLUDED.added_at,
          source_event_id = EXCLUDED.source_event_id,
          payload = EXCLUDED.payload
      `,
      [
        params.profileId,
        params.identity.mediaKey,
        params.identity.mediaType,
        params.identity.tmdbId,
        params.addedAt,
        params.sourceEventId,
        JSON.stringify(params.payload ?? {}),
      ],
    );
  }

  async delete(client: DbClient, profileId: string, mediaKey: string): Promise<void> {
    await client.query(`DELETE FROM watchlist_items WHERE profile_id = $1::uuid AND media_key = $2`, [profileId, mediaKey]);
  }

  async getByMediaKey(client: DbClient, profileId: string, mediaKey: string): Promise<Record<string, unknown> | null> {
    const result = await client.query(
      `SELECT media_key, media_type, tmdb_id, added_at, payload FROM watchlist_items WHERE profile_id = $1::uuid AND media_key = $2`,
      [profileId, mediaKey],
    );
    return result.rows[0] ?? null;
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
        tableName: 'watchlist_items',
        sortColumn: 'added_at',
      }),
      [profileId, cursor?.sortValue ?? null, cursor?.tieBreaker ?? null, limit + 1],
    );
    const rows = result.rows.slice(0, limit);
    return { rows, hasMore: result.rows.length > limit };
  }
}
