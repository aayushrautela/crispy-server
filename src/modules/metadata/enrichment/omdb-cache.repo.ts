import type { DbClient } from '../../../lib/db.js';
import type { OmdbContentView } from '../metadata.types.js';

export class OmdbCacheRepository {
  async findByImdbId(client: DbClient, imdbId: string): Promise<OmdbContentView | null> {
    const result = await client.query(
      `
        SELECT payload
        FROM omdb_content_cache
        WHERE imdb_id = $1
      `,
      [imdbId],
    );

    const payload = result.rows[0]?.payload;
    return isOmdbContentView(payload) ? payload : null;
  }

  async upsert(client: DbClient, imdbId: string, payload: OmdbContentView): Promise<OmdbContentView> {
    const result = await client.query(
      `
        INSERT INTO omdb_content_cache (imdb_id, payload, fetched_at, updated_at)
        VALUES ($1, $2::jsonb, now(), now())
        ON CONFLICT (imdb_id)
        DO UPDATE SET
          payload = EXCLUDED.payload,
          fetched_at = now(),
          updated_at = now()
        RETURNING payload
      `,
      [imdbId, JSON.stringify(payload)],
    );

    const cachedPayload = result.rows[0]?.payload;
    return isOmdbContentView(cachedPayload) ? cachedPayload : payload;
  }
}

function isOmdbContentView(value: unknown): value is OmdbContentView {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const payload = value as Record<string, unknown>;
  return typeof payload.imdbId === 'string';
}
