import type { DbClient } from '../../lib/db.js';
import type { MediaIdentity } from './media-key.js';
import type { WatchMediaProjection } from './watch.types.js';

export class WatchlistRepository {
  async put(client: DbClient, params: {
    profileId: string;
    identity: MediaIdentity;
    sourceEventId: string;
    addedAt: string;
    payload?: Record<string, unknown>;
    projection?: WatchMediaProjection;
  }): Promise<void> {
    await client.query(
      `
        INSERT INTO watchlist_items (
          profile_id, media_key, media_type, tmdb_id, title, subtitle, poster_url, backdrop_url, added_at, source_event_id, payload
        )
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10::uuid, $11::jsonb)
        ON CONFLICT (profile_id, media_key)
        DO UPDATE SET
          title = COALESCE(watchlist_items.title, EXCLUDED.title),
          subtitle = COALESCE(watchlist_items.subtitle, EXCLUDED.subtitle),
          poster_url = COALESCE(watchlist_items.poster_url, EXCLUDED.poster_url),
          backdrop_url = COALESCE(watchlist_items.backdrop_url, EXCLUDED.backdrop_url),
          added_at = EXCLUDED.added_at,
          source_event_id = EXCLUDED.source_event_id,
          payload = EXCLUDED.payload
      `,
      [
        params.profileId,
        params.identity.mediaKey,
        params.identity.mediaType,
        params.identity.tmdbId,
        params.projection?.title ?? null,
        params.projection?.subtitle ?? null,
        params.projection?.posterUrl ?? null,
        params.projection?.backdropUrl ?? null,
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
    const result = await client.query(
      `
        SELECT media_key, media_type, tmdb_id, added_at, payload
             , title, subtitle, poster_url, backdrop_url
        FROM watchlist_items
        WHERE profile_id = $1::uuid
        ORDER BY added_at DESC
        LIMIT $2
      `,
      [profileId, limit],
    );
    return result.rows;
  }
}
