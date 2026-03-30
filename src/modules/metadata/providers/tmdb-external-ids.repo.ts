import type { DbClient } from '../../../lib/db.js';
import { requireDbIsoString } from '../../../lib/time.js';

export type TmdbExternalIdRecord = {
  source: string;
  externalId: string;
  mediaType: string;
  tmdbId: number;
  raw: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

function mapExternalId(row: Record<string, unknown>): TmdbExternalIdRecord {
  return {
    source: String(row.source),
    externalId: String(row.external_id),
    mediaType: String(row.media_type),
    tmdbId: Number(row.tmdb_id),
    raw: (row.raw as Record<string, unknown> | undefined) ?? {},
    createdAt: requireDbIsoString(row.created_at as Date | string | null | undefined, 'tmdb_external_ids.created_at'),
    updatedAt: requireDbIsoString(row.updated_at as Date | string | null | undefined, 'tmdb_external_ids.updated_at'),
  };
}

export class TmdbExternalIdsRepository {
  async findByExternalId(client: DbClient, params: {
    source: string;
    externalId: string;
    mediaType: string;
  }): Promise<TmdbExternalIdRecord | null> {
    const result = await client.query(
      `
        SELECT source, external_id, media_type, tmdb_id, raw, created_at, updated_at
        FROM tmdb_external_ids
        WHERE source = $1 AND external_id = $2 AND media_type = $3
      `,
      [params.source, params.externalId, params.mediaType],
    );
    return result.rows[0] ? mapExternalId(result.rows[0]) : null;
  }

  async upsert(client: DbClient, params: {
    source: string;
    externalId: string;
    mediaType: string;
    tmdbId: number;
    raw?: Record<string, unknown>;
  }): Promise<TmdbExternalIdRecord> {
    const result = await client.query(
      `
        INSERT INTO tmdb_external_ids (source, external_id, media_type, tmdb_id, raw)
        VALUES ($1, $2, $3, $4, $5::jsonb)
        ON CONFLICT (source, external_id, media_type)
        DO UPDATE SET tmdb_id = EXCLUDED.tmdb_id, raw = EXCLUDED.raw, updated_at = now()
        RETURNING source, external_id, media_type, tmdb_id, raw, created_at, updated_at
      `,
      [params.source, params.externalId, params.mediaType, params.tmdbId, JSON.stringify(params.raw ?? {})],
    );
    return mapExternalId(result.rows[0]);
  }
}
