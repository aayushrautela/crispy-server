import type { QueryResult } from 'pg';
import type { RecommendationListItemInput, RecommendationListWriteResult, RecommendationWriteActor } from './recommendation-list.types.js';

type Queryable = { query: (text: string, params?: unknown[]) => Promise<QueryResult> };

export interface RecommendationListRepo {
  findIdempotencyRecord(input: { actorKey: string; operationKey: string; idempotencyKey: string }): Promise<RecommendationWriteIdempotencyRecord | null>;
  saveIdempotencyRecord(input: SaveRecommendationWriteIdempotencyInput): Promise<void>;
  createListVersion(input: CreateRecommendationListVersionInput): Promise<RecommendationListVersionRecord>;
  replaceActiveVersion(input: { accountId: string; profileId: string; listKey: string; source: string; version: number; updatedAt: Date }): Promise<void>;
  clearActiveList(input: { accountId: string; profileId: string; listKey: string; source: string; actor: RecommendationWriteActor; idempotencyKey: string; clearedAt: Date }): Promise<RecommendationListWriteResult>;
}

export interface RecommendationWriteIdempotencyRecord {
  idempotencyKey: string;
  actorKey: string;
  operationKey: string;
  responseBody: RecommendationListWriteResult;
  requestHash: string;
  createdAt: Date;
}

export interface SaveRecommendationWriteIdempotencyInput {
  actorKey: string;
  operationKey: string;
  idempotencyKey: string;
  requestHash: string;
  responseBody: RecommendationListWriteResult;
  createdAt: Date;
}

export interface CreateRecommendationListVersionInput {
  accountId: string;
  profileId: string;
  listKey: string;
  source: string;
  items: RecommendationListItemInput[];
  actor: RecommendationWriteActor;
  purpose?: string;
  runId?: string;
  batchId?: string;
  inputVersions?: { eligibilityVersion?: number; signalsVersion?: number; modelVersion?: string; algorithm?: string };
  createdAt: Date;
}

export interface RecommendationListVersionRecord {
  accountId: string;
  profileId: string;
  listKey: string;
  source: string;
  version: number;
  itemCount: number;
  createdAt: Date;
}

export class SqlRecommendationListRepo implements RecommendationListRepo {
  constructor(private readonly deps: { db: Queryable }) {}

  async findIdempotencyRecord(input: { actorKey: string; operationKey: string; idempotencyKey: string }): Promise<RecommendationWriteIdempotencyRecord | null> {
    const result = await this.deps.db.query(
      `SELECT actor_key, operation_key, idempotency_key, request_hash, response_body, created_at
       FROM recommendation_write_idempotency
       WHERE actor_key = $1 AND operation_key = $2 AND idempotency_key = $3`,
      [input.actorKey, input.operationKey, input.idempotencyKey],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      actorKey: String(row.actor_key),
      operationKey: String(row.operation_key),
      idempotencyKey: String(row.idempotency_key),
      requestHash: String(row.request_hash),
      responseBody: row.response_body as RecommendationListWriteResult,
      createdAt: new Date(row.created_at as string),
    };
  }

  async saveIdempotencyRecord(input: SaveRecommendationWriteIdempotencyInput): Promise<void> {
    await this.deps.db.query(
      `INSERT INTO recommendation_write_idempotency (actor_key, operation_key, idempotency_key, request_hash, response_body, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       ON CONFLICT (actor_key, operation_key, idempotency_key) DO NOTHING`,
      [input.actorKey, input.operationKey, input.idempotencyKey, input.requestHash, JSON.stringify(input.responseBody), input.createdAt],
    );
  }

  async createListVersion(input: CreateRecommendationListVersionInput): Promise<RecommendationListVersionRecord> {
    const actorId = input.actor.type === 'app' ? input.actor.appId : input.actor.accountId;
    const actorKeyId = input.actor.type === 'app' ? input.actor.keyId : input.actor.userId ?? null;
    const result = await this.deps.db.query(
      `WITH next_version AS (
         SELECT COALESCE(MAX(version), 0) + 1 AS version
         FROM recommendation_list_versions
         WHERE account_id = $1::uuid AND profile_id = $2::uuid AND source = $3 AND list_key = $4
       )
       INSERT INTO recommendation_list_versions (account_id, profile_id, source, list_key, version, items_json, item_count, actor_type, actor_id, actor_key_id, purpose, run_id, batch_id, input_versions, created_at)
       SELECT $1::uuid, $2::uuid, $3, $4, version, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14 FROM next_version
       RETURNING account_id, profile_id, source, list_key, version, item_count, created_at`,
      [input.accountId, input.profileId, input.source, input.listKey, JSON.stringify(input.items), input.items.length, input.actor.type, actorId, actorKeyId, input.purpose ?? null, input.runId ?? null, input.batchId ?? null, JSON.stringify(input.inputVersions ?? {}), input.createdAt],
    );
    const row = result.rows[0];
    return { accountId: String(row.account_id), profileId: String(row.profile_id), source: String(row.source), listKey: String(row.list_key), version: Number(row.version), itemCount: Number(row.item_count), createdAt: new Date(row.created_at as string) };
  }

  async replaceActiveVersion(input: { accountId: string; profileId: string; listKey: string; source: string; version: number; updatedAt: Date }): Promise<void> {
    await this.deps.db.query(
      `INSERT INTO recommendation_active_lists (account_id, profile_id, source, list_key, active_version, updated_at)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)
       ON CONFLICT (account_id, profile_id, source, list_key)
       DO UPDATE SET active_version = EXCLUDED.active_version, updated_at = EXCLUDED.updated_at, deleted_at = NULL`,
      [input.accountId, input.profileId, input.source, input.listKey, input.version, input.updatedAt],
    );
  }

  async clearActiveList(input: { accountId: string; profileId: string; listKey: string; source: string; actor: RecommendationWriteActor; idempotencyKey: string; clearedAt: Date }): Promise<RecommendationListWriteResult> {
    await this.deps.db.query(
      `UPDATE recommendation_active_lists SET deleted_at = $5, updated_at = $5 WHERE account_id = $1::uuid AND profile_id = $2::uuid AND source = $3 AND list_key = $4`,
      [input.accountId, input.profileId, input.source, input.listKey, input.clearedAt],
    );
    return { accountId: input.accountId, profileId: input.profileId, listKey: input.listKey, source: input.source, version: 0, status: 'cleared', itemCount: 0, idempotency: { key: input.idempotencyKey, replayed: false }, createdAt: input.clearedAt };
  }
}
