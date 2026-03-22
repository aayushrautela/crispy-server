import type { DbClient } from '../../lib/db.js';
import type { MediaIdentity } from './media-key.js';

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
          profile_id, media_key, media_type, tmdb_id, title, subtitle, poster_url, backdrop_url, rating, rated_at, source_event_id, payload
        )
        VALUES ($1::uuid, $2, $3, $4, NULL, NULL, NULL, NULL, $9, $10::timestamptz, $11::uuid, $12::jsonb)
        ON CONFLICT (profile_id, media_key)
        DO UPDATE SET
          title = COALESCE(ratings.title, EXCLUDED.title),
          subtitle = COALESCE(ratings.subtitle, EXCLUDED.subtitle),
          poster_url = COALESCE(ratings.poster_url, EXCLUDED.poster_url),
          backdrop_url = COALESCE(ratings.backdrop_url, EXCLUDED.backdrop_url),
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
    const result = await client.query(
      `
        SELECT media_key, media_type, tmdb_id, rating, rated_at, payload
        FROM ratings
        WHERE profile_id = $1::uuid
        ORDER BY rated_at DESC
        LIMIT $2
      `,
      [profileId, limit],
    );
    return result.rows;
  }
}
