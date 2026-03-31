import type { DbClient } from '../../lib/db.js';
import type { MediaIdentity } from '../identity/media-key.js';
import type { WatchMediaProjection } from './watch.types.js';
import {
  WATCH_PROJECTION_COLUMN_LIST,
  watchProjectionParams,
  watchProjectionPlaceholders,
  watchProjectionSelectList,
  watchProjectionUpdateAssignments,
} from './watch-projection.persistence.js';

export class RatingsRepository {
  async put(client: DbClient, params: {
    profileId: string;
    identity: MediaIdentity;
    sourceEventId: string;
    ratedAt: string;
    rating: number;
    payload?: Record<string, unknown>;
    projection?: WatchMediaProjection;
  }): Promise<void> {
    await client.query(
      `
        INSERT INTO ratings (
          profile_id, media_key, media_type, tmdb_id, ${WATCH_PROJECTION_COLUMN_LIST}, title, subtitle, poster_url, backdrop_url, rating, rated_at, source_event_id, payload
        )
         VALUES (
           $1::uuid, $2, $3, $4, ${watchProjectionPlaceholders(5)}, $40, $41, $42, $43, $44, $45::timestamptz, $46::uuid, $47::jsonb
         )
        ON CONFLICT (profile_id, media_key)
        DO UPDATE SET
          ${watchProjectionUpdateAssignments()},
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
        ...watchProjectionParams(params.projection),
        params.projection?.title ?? null,
        params.projection?.subtitle ?? null,
        params.projection?.posterUrl ?? null,
        params.projection?.backdropUrl ?? null,
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
      `SELECT media_key, media_type, tmdb_id, ${watchProjectionSelectList()}, rating, rated_at, payload FROM ratings WHERE profile_id = $1::uuid AND media_key = $2`,
      [profileId, mediaKey],
    );
    return result.rows[0] ?? null;
  }

  async list(client: DbClient, profileId: string, limit: number): Promise<Record<string, unknown>[]> {
    const result = await client.query(
      `
        SELECT media_key, media_type, tmdb_id, rating, rated_at, payload
             , ${watchProjectionSelectList()}
             , title, subtitle, poster_url, backdrop_url
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
