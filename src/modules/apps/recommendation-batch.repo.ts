import crypto from 'node:crypto';
import type pg from 'pg';
import type { RecommendationBatch, RecommendationBatchStatus } from './recommendation-batch.types.js';

type QueryableDb = Pick<pg.Pool | pg.PoolClient, 'query'>;

export interface RecommendationBatchRepo {
  createBatch(input: CreateRecommendationBatchRecordInput): Promise<RecommendationBatch>;
  getBatch(input: { appId: string; runId: string; batchId: string }): Promise<RecommendationBatch | null>;
  updateBatch(input: UpdateRecommendationBatchRecordInput): Promise<RecommendationBatch>;
}

export interface CreateRecommendationBatchRecordInput {
  appId: string;
  runId: string;
  snapshotId?: string | null;
  status: RecommendationBatchStatus;
  items?: Array<{ snapshotItemId?: string; accountId: string; profileId: string }>;
  leaseSeconds?: number;
  createdAt: Date;
}

export interface UpdateRecommendationBatchRecordInput {
  appId: string;
  runId: string;
  batchId: string;
  status?: RecommendationBatchStatus;
  progress?: Record<string, number>;
  errors?: Array<Record<string, unknown>>;
  updatedAt: Date;
}

export class SqlRecommendationBatchRepo implements RecommendationBatchRepo {
  constructor(private readonly deps: { db: QueryableDb }) {}

  async createBatch(input: CreateRecommendationBatchRecordInput): Promise<RecommendationBatch> {
    const batchId = crypto.randomUUID();
    const leaseId = input.leaseSeconds ? crypto.randomUUID() : null;
    const leaseExpiresAt = input.leaseSeconds
      ? new Date(input.createdAt.getTime() + input.leaseSeconds * 1000)
      : null;
    const itemCount = input.items?.length ?? 0;

    const result = await this.deps.db.query(
      `INSERT INTO app_recommendation_batches
        (batch_id, run_id, app_id, status, snapshot_id, lease_id, lease_expires_at, item_count, items, progress, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, '{}'::jsonb, $10, $10)
       RETURNING batch_id, run_id, app_id, status, snapshot_id, lease_id, lease_expires_at, item_count, items, progress, errors, created_at, updated_at`,
      [
        batchId,
        input.runId,
        input.appId,
        input.status,
        input.snapshotId ?? null,
        leaseId,
        leaseExpiresAt,
        itemCount,
        input.items ? JSON.stringify(input.items) : null,
        input.createdAt,
      ],
    );
    return mapBatchRow(result.rows[0] as RecommendationBatchRow);
  }

  async getBatch(input: { appId: string; runId: string; batchId: string }): Promise<RecommendationBatch | null> {
    const result = await this.deps.db.query(
      `SELECT batch_id, run_id, app_id, status, snapshot_id, lease_id, lease_expires_at, item_count, items, progress, errors, created_at, updated_at
         FROM app_recommendation_batches
        WHERE app_id = $1 AND run_id = $2 AND batch_id = $3`,
      [input.appId, input.runId, input.batchId],
    );
    return result.rows[0] ? mapBatchRow(result.rows[0] as RecommendationBatchRow) : null;
  }

  async updateBatch(input: UpdateRecommendationBatchRecordInput): Promise<RecommendationBatch> {
    const result = await this.deps.db.query(
      `UPDATE app_recommendation_batches
          SET status = COALESCE($4, status),
              progress = COALESCE(progress, '{}'::jsonb) || COALESCE($5::jsonb, '{}'::jsonb),
              errors = COALESCE($6::jsonb, errors),
              updated_at = $7
        WHERE app_id = $1 AND run_id = $2 AND batch_id = $3
        RETURNING batch_id, run_id, app_id, status, snapshot_id, lease_id, lease_expires_at, item_count, items, progress, errors, created_at, updated_at`,
      [
        input.appId,
        input.runId,
        input.batchId,
        input.status ?? null,
        input.progress ? JSON.stringify(input.progress) : null,
        input.errors ? JSON.stringify(input.errors) : null,
        input.updatedAt,
      ],
    );
    if (!result.rows[0]) {
      throw new Error('recommendation_batch_not_found');
    }
    return mapBatchRow(result.rows[0] as RecommendationBatchRow);
  }
}

interface RecommendationBatchRow {
  batch_id: string;
  run_id: string;
  app_id: string;
  status: RecommendationBatchStatus;
  snapshot_id: string | null;
  lease_id: string | null;
  lease_expires_at: Date | null;
  item_count: number;
  items: Array<Record<string, unknown>> | null;
  progress: Record<string, number> | null;
  errors: Array<Record<string, unknown>> | null;
  created_at: Date;
  updated_at: Date;
}

function mapBatchRow(row: RecommendationBatchRow): RecommendationBatch {
  return {
    batchId: row.batch_id,
    runId: row.run_id,
    appId: row.app_id,
    status: row.status,
    snapshotId: row.snapshot_id,
    lease:
      row.lease_id && row.lease_expires_at
        ? { leaseId: row.lease_id, expiresAt: row.lease_expires_at }
        : null,
    itemCount: row.item_count,
    progress: row.progress ?? undefined,
    errors: row.errors ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
