import type { DbClient } from '../../lib/db.js';
import type { MediaIdentity } from '../identity/media-key.js';
export class RatingsRepository {
  async put(client: DbClient, params: {
    profileId: string;
    identity: MediaIdentity;
    sourceEventId: string;
    ratedAt: string;
    rating: number;
    payload?: Record<string, unknown>;
  }): Promise<void> {
    await client.query(
      `
        INSERT INTO ratings (
          profile_id, media_key, media_type, tmdb_id, rating, rated_at, source_event_id, payload
        )
         VALUES (
           $1::uuid, $2, $3, $4, $5, $6::timestamptz, $7::uuid, $8::jsonb
         )
        ON CONFLICT (profile_id, media_key)
        DO UPDATE SET
          rating = EXCLUDED.rating,
          rated_at = EXCLUDED.rated_at,
          source_event_id = EXCLUDED.source_event_id,
          payload = EXCLUDED.payload
      `,
      [
        params.profileId,
        params.identity.mediaKey,
        params.identity.mediaType,
        params.identity.tmdbId,
        params.rating,
        params.ratedAt,
        params.sourceEventId,
        JSON.stringify(params.payload ?? {}),
      ],
    );
  }

  async delete(client: DbClient, profileId: string, mediaKey: string): Promise<void> {
    await client.query(`DELETE FROM ratings WHERE profile_id = $1::uuid AND media_key = $2`, [profileId, mediaKey]);
  }

  async getByMediaKey(client: DbClient, profileId: string, mediaKey: string): Promise<Record<string, unknown> | null> {
    const result = await client.query(
      `SELECT media_key, media_type, tmdb_id, rating, rated_at, payload FROM ratings WHERE profile_id = $1::uuid AND media_key = $2`,
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
      `
        SELECT media_key, media_type, tmdb_id, rating, rated_at, payload
        FROM ratings
        WHERE profile_id = $1::uuid
          AND (
            $2::timestamptz IS NULL
            OR rated_at < $2::timestamptz
            OR (rated_at = $2::timestamptz AND media_key < $3)
          )
        ORDER BY rated_at DESC, media_key DESC
        LIMIT $4
      `,
      [profileId, cursor?.sortValue ?? null, cursor?.tieBreaker ?? null, limit + 1],
    );
    const rows = result.rows.slice(0, limit);
    return { rows, hasMore: result.rows.length > limit };
  }
}
