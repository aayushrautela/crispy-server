import type { DbClient } from '../../lib/db.js';

export type RecommendationSnapshotRecord = {
  profileId: string;
  historyGeneration: number;
  algorithmVersion: string;
  sourceCursor: string | null;
  generatedAt: string;
  expiresAt: string | null;
  items: unknown[];
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
        SELECT profile_id, history_generation, algorithm_version, source_cursor, generated_at, expires_at, items, updated_at
        FROM recommendation_snapshots
        WHERE profile_id = $1::uuid
        ORDER BY generated_at DESC, algorithm_version ASC
      `,
      [profileId],
    );
    return result.rows.map((row) => mapSnapshot(row));
  }
}
