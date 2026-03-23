import type { DbClient } from '../../lib/db.js';

export type RecommendationSnapshotRecord = {
  profileId: string;
  historyGeneration: number;
  algorithmVersion: string;
  sourceCursor: string | null;
  generatedAt: string;
  expiresAt: string | null;
  items: unknown[];
  source: string;
  updatedByKind: string;
  updatedById: string | null;
  updatedAt: string;
};

function mapSnapshot(row: Record<string, unknown>): RecommendationSnapshotRecord {
  return {
    profileId: String(row.profile_id),
    historyGeneration: Number(row.history_generation),
    algorithmVersion: String(row.algorithm_version),
    sourceCursor: typeof row.source_cursor === 'string' ? row.source_cursor : null,
    generatedAt: String(row.generated_at),
    expiresAt: typeof row.expires_at === 'string' ? row.expires_at : null,
    items: Array.isArray(row.items) ? row.items : [],
    source: String(row.source ?? 'unknown'),
    updatedByKind: String(row.updated_by_kind ?? 'service'),
    updatedById: typeof row.updated_by_id === 'string' ? row.updated_by_id : null,
    updatedAt: String(row.updated_at),
  };
}

export class RecommendationSnapshotsRepository {
  async clearForProfile(client: DbClient, profileId: string): Promise<void> {
    await client.query(`DELETE FROM recommendation_snapshots WHERE profile_id = $1::uuid`, [profileId]);
  }

  async listForProfile(client: DbClient, profileId: string): Promise<RecommendationSnapshotRecord[]> {
    const result = await client.query(
      `
        SELECT profile_id, history_generation, algorithm_version, source_cursor, generated_at, expires_at,
               items, source, updated_by_kind, updated_by_id, updated_at
        FROM recommendation_snapshots
        WHERE profile_id = $1::uuid
        ORDER BY generated_at DESC, algorithm_version ASC
      `,
      [profileId],
    );
    return result.rows.map((row) => mapSnapshot(row));
  }

  async findByProfileAndAlgorithm(
    client: DbClient,
    profileId: string,
    algorithmVersion: string,
  ): Promise<RecommendationSnapshotRecord | null> {
    const result = await client.query(
      `
        SELECT profile_id, history_generation, algorithm_version, source_cursor, generated_at, expires_at,
               items, source, updated_by_kind, updated_by_id, updated_at
        FROM recommendation_snapshots
        WHERE profile_id = $1::uuid AND algorithm_version = $2
      `,
      [profileId, algorithmVersion],
    );
    return result.rows[0] ? mapSnapshot(result.rows[0]) : null;
  }

  async upsert(client: DbClient, params: {
    profileId: string;
    historyGeneration: number;
    algorithmVersion: string;
    sourceCursor?: string | null;
    generatedAt: string;
    expiresAt?: string | null;
    items: unknown[];
    source: string;
    updatedByKind: string;
    updatedById?: string | null;
  }): Promise<RecommendationSnapshotRecord> {
    const result = await client.query(
      `
        INSERT INTO recommendation_snapshots (
          profile_id,
          history_generation,
          algorithm_version,
          source_cursor,
          generated_at,
          expires_at,
          items,
          source,
          updated_by_kind,
          updated_by_id
        )
        VALUES ($1::uuid, $2, $3, $4, $5::timestamptz, $6::timestamptz, $7::jsonb, $8, $9, $10)
        ON CONFLICT (profile_id, algorithm_version)
        DO UPDATE SET
          history_generation = EXCLUDED.history_generation,
          source_cursor = EXCLUDED.source_cursor,
          generated_at = EXCLUDED.generated_at,
          expires_at = EXCLUDED.expires_at,
          items = EXCLUDED.items,
          source = EXCLUDED.source,
          updated_by_kind = EXCLUDED.updated_by_kind,
          updated_by_id = EXCLUDED.updated_by_id,
          updated_at = now()
        RETURNING profile_id, history_generation, algorithm_version, source_cursor, generated_at, expires_at,
                  items, source, updated_by_kind, updated_by_id, updated_at
      `,
      [
        params.profileId,
        params.historyGeneration,
        params.algorithmVersion,
        params.sourceCursor ?? null,
        params.generatedAt,
        params.expiresAt ?? null,
        JSON.stringify(params.items),
        params.source,
        params.updatedByKind,
        params.updatedById ?? null,
      ],
    );

    return mapSnapshot(result.rows[0]);
  }
}
