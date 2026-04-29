import type { DbClient } from '../../lib/db.js';
import { requireDbIsoString } from '../../lib/time.js';
import { HttpError } from '../../lib/errors.js';
import type { PublicAccountWriteActor } from './public-account-write.types.js';

export interface PublicRecommendationListRecord {
  id: string;
  accountId: string;
  profileId: string;
  listKey: string;
  schemaVersion: string;
  mediaType: string;
  locale: string | null;
  summary: string | null;
  itemsJson: unknown[];
  itemCount: number;
  requestHash: string;
  version: number;
  updatedAt: string;
}

export class PublicRecommendationWriteRepo {
  async getCurrentList(client: DbClient, params: { accountId: string; profileId: string; listKey: string }): Promise<PublicRecommendationListRecord | null> {
    const result = await client.query(
      `SELECT id, account_id, profile_id, list_key, schema_version, media_type, locale, summary, items_json, item_count, request_hash, version, updated_at
       FROM public_account_recommendation_lists
       WHERE account_id = $1::uuid AND profile_id = $2::uuid AND source = 'account_api' AND list_key = $3 AND deleted_at IS NULL`,
      [params.accountId, params.profileId, params.listKey],
    );
    return result.rows[0] ? mapRecord(result.rows[0]) : null;
  }

  async upsertCurrentList(client: DbClient, params: {
    accountId: string;
    profileId: string;
    listKey: string;
    schemaVersion: string;
    mediaType: string;
    locale?: string;
    summary?: string;
    itemsJson: unknown[];
    requestHash: string;
    actor: PublicAccountWriteActor;
    ifMatchVersion?: number;
    idempotencyKeyHash?: string;
  }): Promise<{ record: PublicRecommendationListRecord; created: boolean; changed: boolean }> {
    const existingResult = await client.query(
      `SELECT * FROM public_account_recommendation_lists
       WHERE account_id = $1::uuid AND profile_id = $2::uuid AND source = 'account_api' AND list_key = $3 AND deleted_at IS NULL
       FOR UPDATE`,
      [params.accountId, params.profileId, params.listKey],
    );
    const existing = existingResult.rows[0];
    if (params.ifMatchVersion !== undefined && (!existing || Number(existing.version) !== params.ifMatchVersion)) {
      throw new HttpError(412, 'Precondition failed.', undefined, 'PRECONDITION_FAILED');
    }
    if (existing && String(existing.request_hash) === params.requestHash) {
      return { record: mapRecord(existing), created: false, changed: false };
    }
    if (!existing) {
      const insert = await client.query(
        `INSERT INTO public_account_recommendation_lists (account_id, profile_id, source, list_key, schema_version, media_type, locale, summary, items_json, item_count, request_hash, version, idempotency_key_hash, created_by_type, created_by_id, updated_by_type, updated_by_id)
         VALUES ($1::uuid, $2::uuid, 'account_api', $3, $4, $5, $6, $7, $8::jsonb, $9, $10, 1, $11, $12, $13, $12, $13)
         RETURNING *`,
        [params.accountId, params.profileId, params.listKey, params.schemaVersion, params.mediaType, params.locale ?? null, params.summary ?? null, JSON.stringify(params.itemsJson), params.itemsJson.length, params.requestHash, params.idempotencyKeyHash ?? null, params.actor.type, params.actor.id],
      );
      const record = mapRecord(insert.rows[0]);
      await this.insertVersion(client, record, params.actor, params.idempotencyKeyHash);
      return { record, created: true, changed: true };
    }
    const nextVersion = Number(existing.version) + 1;
    const update = await client.query(
      `UPDATE public_account_recommendation_lists
       SET schema_version = $4, media_type = $5, locale = $6, summary = $7, items_json = $8::jsonb, item_count = $9, request_hash = $10, version = $11, idempotency_key_hash = $12, updated_by_type = $13, updated_by_id = $14, updated_at = now()
       WHERE id = $1::uuid
       RETURNING *`,
      [existing.id, params.accountId, params.profileId, params.schemaVersion, params.mediaType, params.locale ?? null, params.summary ?? null, JSON.stringify(params.itemsJson), params.itemsJson.length, params.requestHash, nextVersion, params.idempotencyKeyHash ?? null, params.actor.type, params.actor.id],
    );
    const record = mapRecord(update.rows[0]);
    await this.insertVersion(client, record, params.actor, params.idempotencyKeyHash);
    return { record, created: false, changed: true };
  }

  async softDeleteCurrentList(client: DbClient, params: { accountId: string; profileId: string; listKey: string; actor: PublicAccountWriteActor; ifMatchVersion?: number; idempotencyKeyHash?: string }): Promise<number | null> {
    const existingResult = await client.query(
      `SELECT * FROM public_account_recommendation_lists
       WHERE account_id = $1::uuid AND profile_id = $2::uuid AND source = 'account_api' AND list_key = $3 AND deleted_at IS NULL
       FOR UPDATE`,
      [params.accountId, params.profileId, params.listKey],
    );
    const existing = existingResult.rows[0];
    if (params.ifMatchVersion !== undefined && (!existing || Number(existing.version) !== params.ifMatchVersion)) {
      throw new HttpError(412, 'Precondition failed.', undefined, 'PRECONDITION_FAILED');
    }
    if (!existing) return null;
    await client.query(
      `UPDATE public_account_recommendation_lists SET deleted_at = now(), updated_at = now(), updated_by_type = $2, updated_by_id = $3, idempotency_key_hash = $4 WHERE id = $1::uuid`,
      [existing.id, params.actor.type, params.actor.id, params.idempotencyKeyHash ?? null],
    );
    return Number(existing.version);
  }

  private async insertVersion(client: DbClient, record: PublicRecommendationListRecord, actor: PublicAccountWriteActor, idempotencyKeyHash?: string): Promise<void> {
    await client.query(
      `INSERT INTO public_account_recommendation_list_versions (list_id, version, schema_version, media_type, locale, summary, items_json, item_count, request_hash, actor_type, actor_id, idempotency_key_hash)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12)`,
      [record.id, record.version, record.schemaVersion, record.mediaType, record.locale, record.summary, JSON.stringify(record.itemsJson), record.itemCount, record.requestHash, actor.type, actor.id, idempotencyKeyHash ?? null],
    );
  }
}

function mapRecord(row: Record<string, unknown>): PublicRecommendationListRecord {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    profileId: String(row.profile_id),
    listKey: String(row.list_key),
    schemaVersion: String(row.schema_version),
    mediaType: String(row.media_type),
    locale: typeof row.locale === 'string' ? row.locale : null,
    summary: typeof row.summary === 'string' ? row.summary : null,
    itemsJson: Array.isArray(row.items_json) ? row.items_json : [],
    itemCount: Number(row.item_count),
    requestHash: String(row.request_hash),
    version: Number(row.version),
    updatedAt: requireDbIsoString(row.updated_at as Date | string, 'public_account_recommendation_lists.updated_at'),
  };
}
