import type { QueryResult } from 'pg';
import type { BatchUpsertServiceRecommendationListsResult } from './service-recommendation-list.types.js';

type Queryable = { query: (text: string, params?: unknown[]) => Promise<QueryResult> };

export interface ServiceRecommendationListRepo {
  findBatchIdempotency(input: { appId: string; idempotencyKey: string }): Promise<BatchUpsertServiceRecommendationListsResult | null>;
  saveBatchIdempotency(input: { appId: string; idempotencyKey: string; requestHash: string; result: BatchUpsertServiceRecommendationListsResult; createdAt: Date }): Promise<void>;
}

export class SqlServiceRecommendationListRepo implements ServiceRecommendationListRepo {
  constructor(private readonly deps: { db: Queryable }) {}

  async findBatchIdempotency(input: { appId: string; idempotencyKey: string }): Promise<BatchUpsertServiceRecommendationListsResult | null> {
    const result = await this.deps.db.query(
      `SELECT result FROM service_recommendation_batch_idempotency WHERE app_id = $1 AND idempotency_key = $2`,
      [input.appId, input.idempotencyKey],
    );
    return result.rows[0]?.result as BatchUpsertServiceRecommendationListsResult | null;
  }

  async saveBatchIdempotency(input: { appId: string; idempotencyKey: string; requestHash: string; result: BatchUpsertServiceRecommendationListsResult; createdAt: Date }): Promise<void> {
    await this.deps.db.query(
      `INSERT INTO service_recommendation_batch_idempotency (app_id, idempotency_key, request_hash, result, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       ON CONFLICT (app_id, idempotency_key) DO NOTHING`,
      [input.appId, input.idempotencyKey, input.requestHash, JSON.stringify(input.result), input.createdAt],
    );
  }
}
