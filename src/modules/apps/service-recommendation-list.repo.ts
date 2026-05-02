import type { QueryResult } from 'pg';
import type { BatchUpsertServiceRecommendationListsResult, ServiceRecommendationListDescriptor } from './service-recommendation-list.types.js';
import { OFFICIAL_RECOMMENDER_APP_ID, getOfficialRecommenderListDescriptors, isOfficialRecommenderListKey } from './official-recommender-lists.js';

type Queryable = { query: (text: string, params?: unknown[]) => Promise<QueryResult> };

export interface ServiceRecommendationListRepo {
  listWritableServiceLists(input: { appId: string }): Promise<ServiceRecommendationListDescriptor[]>;
  findWritableServiceList(input: { appId: string; listKey: string }): Promise<ServiceRecommendationListDescriptor | null>;
  findBatchIdempotency(input: { appId: string; idempotencyKey: string }): Promise<BatchUpsertServiceRecommendationListsResult | null>;
  saveBatchIdempotency(input: { appId: string; idempotencyKey: string; requestHash: string; result: BatchUpsertServiceRecommendationListsResult; createdAt: Date }): Promise<void>;
}

export class SqlServiceRecommendationListRepo implements ServiceRecommendationListRepo {
  constructor(private readonly deps: { db: Queryable }) {}

  async listWritableServiceLists(input: { appId: string }): Promise<ServiceRecommendationListDescriptor[]> {
    if (input.appId === OFFICIAL_RECOMMENDER_APP_ID) return getOfficialRecommenderListDescriptors();
    const result = await this.deps.db.query(
      `SELECT so.owner_app_id, so.source, list_key
       FROM app_source_ownership so
       CROSS JOIN LATERAL unnest(so.allowed_list_keys) AS list_key
       WHERE so.owner_app_id = $1 AND so.status = 'active'
       ORDER BY list_key`,
      [input.appId],
    );
    return result.rows.map(mapDescriptor);
  }

  async findWritableServiceList(input: { appId: string; listKey: string }): Promise<ServiceRecommendationListDescriptor | null> {
    if (input.appId === OFFICIAL_RECOMMENDER_APP_ID) {
      return isOfficialRecommenderListKey(input.listKey)
        ? getOfficialRecommenderListDescriptors().find((descriptor) => descriptor.listKey === input.listKey) ?? null
        : null;
    }
    const result = await this.deps.db.query(
      `SELECT so.owner_app_id, so.source, list_key
       FROM app_source_ownership so
       CROSS JOIN LATERAL unnest(so.allowed_list_keys) AS list_key
       WHERE so.owner_app_id = $1 AND so.status = 'active' AND list_key = $2
       LIMIT 1`,
      [input.appId, input.listKey],
    );
    return result.rows[0] ? mapDescriptor(result.rows[0]) : null;
  }

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

function mapDescriptor(row: Record<string, unknown>): ServiceRecommendationListDescriptor {
  const listKey = String(row.list_key);
  return {
    listKey,
    displayName: listKey.split(/[-_]/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' '),
    ownerAppId: String(row.owner_app_id),
    source: String(row.source),
    itemType: 'content',
    maxItems: 100,
    writeMode: 'replace_versioned',
    requiresEligibilityAtWrite: true,
  };
}
