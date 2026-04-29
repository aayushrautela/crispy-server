import { createHash } from 'node:crypto';
import type { DbClient } from '../../lib/db.js';
import type { PublicAccountWriteActor } from './public-account-write.types.js';
import { PUBLIC_ACCOUNT_WRITE_IDEMPOTENCY_TTL_MS } from './public-account-write.constants.js';

export interface PublicWriteIdempotencyRecord {
  id: string;
  accountId: string;
  principalType: string;
  principalId: string;
  operationKey: string;
  idempotencyKeyHash: string;
  requestHash: string;
  responseStatus: number;
  responseJson: unknown | null;
  expiresAt: Date;
  createdAt: Date;
}

export class PublicAccountWriteIdempotencyRepo {
  async findActive(client: DbClient, params: {
    accountId: string;
    principalType: string;
    principalId: string;
    operationKey: string;
    idempotencyKeyHash: string;
    now: Date;
  }): Promise<PublicWriteIdempotencyRecord | null> {
    const result = await client.query(
      `SELECT * FROM public_account_write_idempotency_keys
       WHERE account_id = $1::uuid AND principal_type = $2 AND principal_id = $3 AND operation_key = $4 AND idempotency_key_hash = $5 AND expires_at > $6`,
      [params.accountId, params.principalType, params.principalId, params.operationKey, params.idempotencyKeyHash, params.now],
    );
    return result.rows[0] ? mapRecord(result.rows[0]) : null;
  }

  async insert(client: DbClient, params: {
    accountId: string;
    principalType: string;
    principalId: string;
    operationKey: string;
    idempotencyKeyHash: string;
    requestHash: string;
    responseStatus: number;
    responseJson: unknown | null;
    expiresAt: Date;
  }): Promise<void> {
    await client.query(
      `INSERT INTO public_account_write_idempotency_keys (account_id, principal_type, principal_id, operation_key, idempotency_key_hash, request_hash, response_status, response_json, expires_at)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
       ON CONFLICT (account_id, principal_type, principal_id, operation_key, idempotency_key_hash) DO NOTHING`,
      [params.accountId, params.principalType, params.principalId, params.operationKey, params.idempotencyKeyHash, params.requestHash, params.responseStatus, params.responseJson ? JSON.stringify(params.responseJson) : null, params.expiresAt],
    );
  }
}

function mapRecord(row: Record<string, unknown>): PublicWriteIdempotencyRecord {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    principalType: String(row.principal_type),
    principalId: String(row.principal_id),
    operationKey: String(row.operation_key),
    idempotencyKeyHash: String(row.idempotency_key_hash),
    requestHash: String(row.request_hash),
    responseStatus: Number(row.response_status),
    responseJson: row.response_json,
    expiresAt: new Date(row.expires_at as Date | string),
    createdAt: new Date(row.created_at as Date | string),
  };
}

export function hashIdempotencyKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function buildOperationKey(input: { method: string; routePattern: string; profileId: string; listKey?: string }): string {
  return input.listKey ? `${input.method}:${input.routePattern}:${input.profileId}:${input.listKey}` : `${input.method}:${input.routePattern}:${input.profileId}`;
}

export function computeIdempotencyExpiry(now: Date): Date {
  return new Date(now.getTime() + PUBLIC_ACCOUNT_WRITE_IDEMPOTENCY_TTL_MS);
}
