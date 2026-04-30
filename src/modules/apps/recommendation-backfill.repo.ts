import type pg from 'pg';
import type {
  RecommendationBackfillAssignment,
  RecommendationBackfillAssignmentStatus,
} from './recommendation-backfill.types.js';

type QueryableDb = Pick<pg.Pool | pg.PoolClient, 'query'>;

export interface RecommendationBackfillRepo {
  listAssignments(input: {
    appId: string;
    status?: RecommendationBackfillAssignmentStatus;
    afterCreatedAt?: Date;
    limit: number;
  }): Promise<RecommendationBackfillAssignment[]>;
}

export class SqlRecommendationBackfillRepo implements RecommendationBackfillRepo {
  constructor(private readonly deps: { db: QueryableDb }) {}

  async listAssignments(input: {
    appId: string;
    status?: RecommendationBackfillAssignmentStatus;
    afterCreatedAt?: Date;
    limit: number;
  }): Promise<RecommendationBackfillAssignment[]> {
    const values: unknown[] = [input.appId];
    const where = ['app_id = $1'];

    if (input.status) {
      values.push(input.status);
      where.push(`status = $${values.length}`);
    }

    if (input.afterCreatedAt) {
      values.push(input.afterCreatedAt);
      where.push(`created_at > $${values.length}`);
    }

    values.push(Math.min(Math.max(input.limit, 1), 100));

    const result = await this.deps.db.query(
      `SELECT assignment_id, app_id, snapshot_id, status, priority, estimated_profile_count,
              profiles_completed, created_at, updated_at, expires_at
         FROM app_recommendation_backfill_assignments
        WHERE ${where.join(' AND ')}
        ORDER BY priority DESC, created_at ASC
        LIMIT $${values.length}`,
      values,
    );

    return result.rows.map((row) => mapBackfillRow(row as RecommendationBackfillRow));
  }
}

interface RecommendationBackfillRow {
  assignment_id: string;
  app_id: string;
  snapshot_id: string;
  status: RecommendationBackfillAssignmentStatus;
  priority: number;
  estimated_profile_count: number;
  profiles_completed: number;
  created_at: Date;
  updated_at: Date;
  expires_at: Date | null;
}

function mapBackfillRow(row: RecommendationBackfillRow): RecommendationBackfillAssignment {
  return {
    assignmentId: row.assignment_id,
    appId: row.app_id,
    snapshotId: row.snapshot_id,
    status: row.status,
    priority: row.priority,
    estimatedProfileCount: row.estimated_profile_count,
    profilesCompleted: row.profiles_completed,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  };
}
