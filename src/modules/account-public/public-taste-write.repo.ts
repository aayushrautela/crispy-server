import type { DbClient } from '../../lib/db.js';
import { requireDbIsoString } from '../../lib/time.js';
import { HttpError } from '../../lib/errors.js';
import type { PublicAccountWriteActor } from './public-account-write.types.js';

export interface PublicTasteProfileRecord {
  id: string;
  accountId: string;
  profileId: string;
  schemaVersion: string;
  summary: string | null;
  locale: string | null;
  signalsJson: unknown[];
  signalCount: number;
  requestHash: string;
  version: number;
  updatedAt: string;
}

export class PublicTasteWriteRepo {
  async getCurrentTaste(client: DbClient, params: { accountId: string; profileId: string }): Promise<PublicTasteProfileRecord | null> {
    const result = await client.query(
      `SELECT id, account_id, profile_id, schema_version, summary, locale, signals_json, signal_count, request_hash, version, updated_at
       FROM public_account_taste_profiles
       WHERE account_id = $1::uuid AND profile_id = $2::uuid AND source = 'account_api' AND deleted_at IS NULL`,
      [params.accountId, params.profileId],
    );
    return result.rows[0] ? mapRecord(result.rows[0]) : null;
  }

  async upsertCurrentTaste(client: DbClient, params: {
    accountId: string;
    profileId: string;
    schemaVersion: string;
    summary?: string;
    locale?: string;
    signalsJson: unknown[];
    requestHash: string;
    actor: PublicAccountWriteActor;
    ifMatchVersion?: number;
    idempotencyKeyHash?: string;
  }): Promise<{ record: PublicTasteProfileRecord; created: boolean; changed: boolean }> {
    const existingResult = await client.query(
      `SELECT * FROM public_account_taste_profiles
       WHERE account_id = $1::uuid AND profile_id = $2::uuid AND source = 'account_api' AND deleted_at IS NULL
       FOR UPDATE`,
      [params.accountId, params.profileId],
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
        `INSERT INTO public_account_taste_profiles (account_id, profile_id, source, schema_version, summary, locale, signals_json, signal_count, request_hash, version, idempotency_key_hash, created_by_type, created_by_id, updated_by_type, updated_by_id)
         VALUES ($1::uuid, $2::uuid, 'account_api', $3, $4, $5, $6::jsonb, $7, $8, 1, $9, $10, $11, $10, $11)
         RETURNING *`,
        [params.accountId, params.profileId, params.schemaVersion, params.summary ?? null, params.locale ?? null, JSON.stringify(params.signalsJson), params.signalsJson.length, params.requestHash, params.idempotencyKeyHash ?? null, params.actor.type, params.actor.id],
      );
      const record = mapRecord(insert.rows[0]);
      await this.insertVersion(client, record, params.actor, params.idempotencyKeyHash);
      return { record, created: true, changed: true };
    }
    const nextVersion = Number(existing.version) + 1;
    const update = await client.query(
      `UPDATE public_account_taste_profiles
       SET schema_version = $2, summary = $3, locale = $4, signals_json = $5::jsonb, signal_count = $6, request_hash = $7, version = $8, idempotency_key_hash = $9, updated_by_type = $10, updated_by_id = $11, updated_at = now()
       WHERE id = $1::uuid
       RETURNING *`,
      [existing.id, params.schemaVersion, params.summary ?? null, params.locale ?? null, JSON.stringify(params.signalsJson), params.signalsJson.length, params.requestHash, nextVersion, params.idempotencyKeyHash ?? null, params.actor.type, params.actor.id],
    );
    const record = mapRecord(update.rows[0]);
    await this.insertVersion(client, record, params.actor, params.idempotencyKeyHash);
    return { record, created: false, changed: true };
  }

  async softDeleteCurrentTaste(client: DbClient, params: { accountId: string; profileId: string; actor: PublicAccountWriteActor; ifMatchVersion?: number; idempotencyKeyHash?: string }): Promise<number | null> {
    const existingResult = await client.query(
      `SELECT * FROM public_account_taste_profiles
       WHERE account_id = $1::uuid AND profile_id = $2::uuid AND source = 'account_api' AND deleted_at IS NULL
       FOR UPDATE`,
      [params.accountId, params.profileId],
    );
    const existing = existingResult.rows[0];
    if (params.ifMatchVersion !== undefined && (!existing || Number(existing.version) !== params.ifMatchVersion)) {
      throw new HttpError(412, 'Precondition failed.', undefined, 'PRECONDITION_FAILED');
    }
    if (!existing) return null;
    await client.query(
      `UPDATE public_account_taste_profiles SET deleted_at = now(), updated_at = now(), updated_by_type = $2, updated_by_id = $3, idempotency_key_hash = $4 WHERE id = $1::uuid`,
      [existing.id, params.actor.type, params.actor.id, params.idempotencyKeyHash ?? null],
    );
    return Number(existing.version);
  }

  private async insertVersion(client: DbClient, record: PublicTasteProfileRecord, actor: PublicAccountWriteActor, idempotencyKeyHash?: string): Promise<void> {
    await client.query(
      `INSERT INTO public_account_taste_profile_versions (taste_profile_id, version, schema_version, summary, locale, signals_json, signal_count, request_hash, actor_type, actor_id, idempotency_key_hash)
       VALUES ($1::uuid, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11)`,
      [record.id, record.version, record.schemaVersion, record.summary, record.locale, JSON.stringify(record.signalsJson), record.signalCount, record.requestHash, actor.type, actor.id, idempotencyKeyHash ?? null],
    );
  }
}

function mapRecord(row: Record<string, unknown>): PublicTasteProfileRecord {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    profileId: String(row.profile_id),
    schemaVersion: String(row.schema_version),
    summary: typeof row.summary === 'string' ? row.summary : null,
    locale: typeof row.locale === 'string' ? row.locale : null,
    signalsJson: Array.isArray(row.signals_json) ? row.signals_json : [],
    signalCount: Number(row.signal_count),
    requestHash: String(row.request_hash),
    version: Number(row.version),
    updatedAt: requireDbIsoString(row.updated_at as Date | string, 'public_account_taste_profiles.updated_at'),
  };
}
