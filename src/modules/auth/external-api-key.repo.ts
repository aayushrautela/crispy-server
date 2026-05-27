import type { DbClient } from '../../lib/db.js';
import { requireDbIsoString, toDbIsoString } from '../../lib/time.js';
import type { AuthScope } from './auth.types.js';

type ExternalApiKeyScope = 'history:read' | 'watchlist:read' | 'ratings:read';

export type ExternalApiKeyRecord = {
  id: string;
  accountId: string;
  name: string;
  keyHash: string;
  keyPreview: string;
  scopes: ExternalApiKeyScope[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const VALID_SCOPES: ReadonlySet<string> = new Set<ExternalApiKeyScope>(['history:read', 'watchlist:read', 'ratings:read']);

function mapExternalApiKey(row: Record<string, unknown>): ExternalApiKeyRecord {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    name: String(row.name),
    keyHash: String(row.key_hash),
    keyPreview: String(row.key_preview),
    scopes: Array.isArray(row.scopes) ? row.scopes.filter((s): s is ExternalApiKeyScope => VALID_SCOPES.has(String(s))) : [],
    expiresAt: toDbIsoString(row.expires_at as Date | string | null | undefined, 'external_api_keys.expires_at'),
    lastUsedAt: toDbIsoString(row.last_used_at as Date | string | null | undefined, 'external_api_keys.last_used_at'),
    revokedAt: toDbIsoString(row.revoked_at as Date | string | null | undefined, 'external_api_keys.revoked_at'),
    createdAt: requireDbIsoString(row.created_at as Date | string | null | undefined, 'external_api_keys.created_at'),
    updatedAt: requireDbIsoString(row.updated_at as Date | string | null | undefined, 'external_api_keys.updated_at'),
  };
}

export class ExternalApiKeyRepository {
  async create(client: DbClient, params: {
    accountId: string;
    name: string;
    keyHash: string;
    keyPreview: string;
    scopes: ExternalApiKeyScope[];
    expiresAt?: string | null;
  }): Promise<ExternalApiKeyRecord> {
    const result = await client.query(
      `
        INSERT INTO private.external_api_keys (account_id, name, key_hash, key_preview, scopes, expires_at)
        VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6::timestamptz)
        RETURNING id, account_id, name, key_hash, key_preview, scopes,
                  expires_at, last_used_at, revoked_at, created_at, updated_at
      `,
      [params.accountId, params.name, params.keyHash, params.keyPreview, JSON.stringify(params.scopes), params.expiresAt ?? null],
    );
    return mapExternalApiKey(result.rows[0]);
  }

  async findActiveByHash(client: DbClient, keyHash: string): Promise<ExternalApiKeyRecord | null> {
    const result = await client.query(
      `
        SELECT id, account_id, name, key_hash, key_preview, scopes,
               expires_at, last_used_at, revoked_at, created_at, updated_at
        FROM private.external_api_keys
        WHERE key_hash = $1
          AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > now())
      `,
      [keyHash],
    );
    return result.rows[0] ? mapExternalApiKey(result.rows[0]) : null;
  }

  async touchLastUsed(client: DbClient, keyId: string): Promise<void> {
    await client.query(
      `UPDATE private.external_api_keys SET last_used_at = now(), updated_at = now() WHERE id = $1::uuid`,
      [keyId],
    );
  }

  async listForUser(client: DbClient, accountId: string): Promise<ExternalApiKeyRecord[]> {
    const result = await client.query(
      `
        SELECT id, account_id, name, key_hash, key_preview, scopes,
               expires_at, last_used_at, revoked_at, created_at, updated_at
        FROM private.external_api_keys
        WHERE account_id = $1::uuid
        ORDER BY created_at DESC
      `,
      [accountId],
    );
    return result.rows.map((row) => mapExternalApiKey(row));
  }

  async revoke(client: DbClient, accountId: string, keyId: string): Promise<ExternalApiKeyRecord | null> {
    const result = await client.query(
      `
        UPDATE private.external_api_keys
        SET revoked_at = now(), updated_at = now()
        WHERE id = $1::uuid
          AND account_id = $2::uuid
          AND revoked_at IS NULL
        RETURNING id, account_id, name, key_hash, key_preview, scopes,
                  expires_at, last_used_at, revoked_at, created_at, updated_at
      `,
      [keyId, accountId],
    );
    return result.rows[0] ? mapExternalApiKey(result.rows[0]) : null;
  }
}
