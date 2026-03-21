import type { DbClient } from '../../lib/db.js';
import type { MediaIdentity } from './media-key.js';

export class RatingsRepository {
  async put(client: DbClient, params: {
    profileId: string;
    identity: MediaIdentity;
    sourceEventId: string;
    ratedAt: string;
    rating: number;
    title?: string | null;
    subtitle?: string | null;
    posterUrl?: string | null;
    backdropUrl?: string | null;
    payload?: Record<string, unknown>;
  }): Promise<void> {
    await client.query(
      `
        INSERT INTO ratings (
          profile_id, media_key, media_type, tmdb_id, title, subtitle, poster_url, backdrop_url, rating, rated_at, source_event_id, payload
        )
        VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::uuid, $12::jsonb)
        ON CONFLICT (profile_id, media_key)
        DO UPDATE SET
          title = EXCLUDED.title,
          subtitle = EXCLUDED.subtitle,
          poster_url = EXCLUDED.poster_url,
          backdrop_url = EXCLUDED.backdrop_url,
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
        params.title ?? null,
        params.subtitle ?? null,
        params.posterUrl ?? null,
        params.backdropUrl ?? null,
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
}
