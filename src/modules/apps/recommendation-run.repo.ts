import crypto from 'node:crypto';
import type pg from 'pg';
import type {
  RecommendationRun,
  RecommendationRunProgress,
  RecommendationRunStatus,
  RecommendationRunType,
} from './recommendation-run.types.js';

type QueryableDb = Pick<pg.Pool | pg.PoolClient, 'query'>;

export interface RecommendationRunRepo {
  createRun(input: CreateRecommendationRunRecordInput): Promise<RecommendationRun>;
  getRun(input: { appId: string; runId: string }): Promise<RecommendationRun | null>;
  updateRun(input: UpdateRecommendationRunRecordInput): Promise<RecommendationRun>;
}

export interface CreateRecommendationRunRecordInput {
  appId: string;
  purpose: string;
  runType: RecommendationRunType;
  status: RecommendationRunStatus;
  modelVersion?: string | null;
  algorithm?: string | null;
  input?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  createdAt: Date;
}

export interface UpdateRecommendationRunRecordInput {
  appId: string;
  runId: string;
  status?: RecommendationRunStatus;
  progress?: RecommendationRunProgress;
  output?: Record<string, unknown> | null;
  error?: Record<string, unknown> | null;
  updatedAt: Date;
  completedAt?: Date | null;
}

export class SqlRecommendationRunRepo implements RecommendationRunRepo {
  constructor(private readonly deps: { db: QueryableDb }) {}

  async createRun(input: CreateRecommendationRunRecordInput): Promise<RecommendationRun> {
    const result = await this.deps.db.query(
      `INSERT INTO app_recommendation_runs
        (run_id, app_id, purpose, run_type, status, model_version, algorithm, input, metadata, progress, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, '{}'::jsonb, $10, $10)
       RETURNING run_id, app_id, purpose, run_type, status, model_version, algorithm, input, output, metadata, error, progress, created_at, updated_at, completed_at`,
      [
        crypto.randomUUID(),
        input.appId,
        input.purpose,
        input.runType,
        input.status,
        input.modelVersion ?? null,
        input.algorithm ?? null,
        input.input ?? null,
        input.metadata ?? null,
        input.createdAt,
      ],
    );
    return mapRunRow(result.rows[0] as RecommendationRunRow);
  }

  async getRun(input: { appId: string; runId: string }): Promise<RecommendationRun | null> {
    const result = await this.deps.db.query(
      `SELECT run_id, app_id, purpose, run_type, status, model_version, algorithm, input, output, metadata, error, progress, created_at, updated_at, completed_at
         FROM app_recommendation_runs
        WHERE app_id = $1 AND run_id = $2`,
      [input.appId, input.runId],
    );
    return result.rows[0] ? mapRunRow(result.rows[0] as RecommendationRunRow) : null;
  }

  async updateRun(input: UpdateRecommendationRunRecordInput): Promise<RecommendationRun> {
    const result = await this.deps.db.query(
      `UPDATE app_recommendation_runs
          SET status = COALESCE($3, status),
              progress = COALESCE(progress, '{}'::jsonb) || COALESCE($4::jsonb, '{}'::jsonb),
              output = COALESCE($5::jsonb, output),
              error = COALESCE($6::jsonb, error),
              updated_at = $7,
              completed_at = CASE WHEN $8::timestamptz IS NOT NULL THEN $8 ELSE completed_at END
        WHERE app_id = $1 AND run_id = $2
        RETURNING run_id, app_id, purpose, run_type, status, model_version, algorithm, input, output, metadata, error, progress, created_at, updated_at, completed_at`,
      [
        input.appId,
        input.runId,
        input.status ?? null,
        input.progress ? JSON.stringify(input.progress) : null,
        input.output ? JSON.stringify(input.output) : null,
        input.error ? JSON.stringify(input.error) : null,
        input.updatedAt,
        input.completedAt ?? null,
      ],
    );
    if (!result.rows[0]) {
      throw new Error('recommendation_run_not_found');
    }
    return mapRunRow(result.rows[0] as RecommendationRunRow);
  }
}

interface RecommendationRunRow {
  run_id: string;
  app_id: string;
  purpose: 'recommendation-generation';
  run_type: RecommendationRunType;
  status: RecommendationRunStatus;
  model_version: string | null;
  algorithm: string | null;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  progress: RecommendationRunProgress | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}

function mapRunRow(row: RecommendationRunRow): RecommendationRun {
  return {
    runId: row.run_id,
    appId: row.app_id,
    purpose: row.purpose,
    runType: row.run_type,
    status: row.status,
    modelVersion: row.model_version,
    algorithm: row.algorithm,
    input: row.input,
    output: row.output,
    metadata: row.metadata,
    error: row.error,
    progress: row.progress ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}
