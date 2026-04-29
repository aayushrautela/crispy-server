import type { DbClient } from '../../../lib/db.js';
import { requireDbIsoString, toDbIsoString } from '../../../lib/time.js';
import type { AccountApiKeyRecord } from './account-api-key.types.js';

function mapAccountApiKey(row: Record<string, unknown>): AccountApiKeyRecord {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    name: String(row.name),
    keyPrefix: String(row.key_prefix),
    keyHash: String(row.key_hash),
    status: String(row.status) as AccountApiKeyRecord['status'],
    createdByUserId: row.created_by_user_id ? String(row.created_by_user_id) : null,
    createdAt: requireDbIsoString(row.created_at as Date | string | null | undefined, 'account_api_keys.created_at'),
    updatedAt: requireDbIsoString(row.updated_at as Date | string | null | undefined, 'account_api_keys.updated_at'),
    lastUsedAt: toDbIsoString(row.last_used_at as Date | string | null | undefined, 'account_api_keys.last_used_at'),
    revokedAt: toDbIsoString(row.revoked_at as Date | string | null | undefined, 'account_api_keys.revoked_at'),
    revokedByUserId: row.revoked_by_user_id ? String(row.revoked_by_user_id) : null,
    rotatedFromKeyId: row.rotated_from_key_id ? String(row.rotated_from_key_id) : null,
    expiresAt: toDbIsoString(row.expires_at as Date | string | null | undefined, 'account_api_keys.expires_at'),
    metadata: typeof row.metadata === 'object' && row.metadata !== null ? (row.metadata as Record<string, unknown>) : {},
  };
}

export class AccountApiKeyRepository {
  async create(client: DbClient, input: {
    accountId: string;
    name: string;
    keyPrefix: string;
    keyHash: string;
    createdByUserId: string;
    expiresAt?: string | null;
    rotatedFromKeyId?: string | null;
  }): Promise<AccountApiKeyRecord> {
    const result = await client.query(
      `
        INSERT INTO account_api_keys (
          account_id,
          name,
          key_prefix,
          key_hash,
          created_by_user_id,
          expires_at,
          rotated_from_key_id
        )
        VALUES ($1::uuid, $2, $3, $4, $5::uuid, $6::timestamptz, $7::uuid)
        RETURNING id, account_id, name, key_prefix, key_hash, status,
                  created_by_user_id, created_at, updated_at, last_used_at,
                  revoked_at, revoked_by_user_id, rotated_from_key_id,
                  expires_at, metadata
      `,
      [
        input.accountId,
        input.name,
        input.keyPrefix,
        input.keyHash,
        input.createdByUserId,
        input.expiresAt ?? null,
        input.rotatedFromKeyId ?? null,
      ],
    );

    return mapAccountApiKey(result.rows[0]);
  }

  async listForAccount(client: DbClient, accountId: string): Promise<AccountApiKeyRecord[]> {
    const result = await client.query(
      `
        SELECT id, account_id, name, key_prefix, key_hash, status,
               created_by_user_id, created_at, updated_at, last_used_at,
               revoked_at, revoked_by_user_id, rotated_from_key_id,
               expires_at, metadata
        FROM account_api_keys
        WHERE account_id = $1::uuid
        ORDER BY created_at DESC
      `,
      [accountId],
    );

    return result.rows.map(mapAccountApiKey);
  }

  async findByIdForAccount(
    client: DbClient,
    accountId: string,
    keyId: string,
  ): Promise<AccountApiKeyRecord | null> {
    const result = await client.query(
      `
        SELECT id, account_id, name, key_prefix, key_hash, status,
               created_by_user_id, created_at, updated_at, last_used_at,
               revoked_at, revoked_by_user_id, rotated_from_key_id,
               expires_at, metadata
        FROM account_api_keys
        WHERE id = $1::uuid
          AND account_id = $2::uuid
      `,
      [keyId, accountId],
    );

    return result.rows[0] ? mapAccountApiKey(result.rows[0]) : null;
  }

  async findActiveByPrefix(
    client: DbClient,
    keyPrefix: string,
  ): Promise<AccountApiKeyRecord | null> {
    const result = await client.query(
      `
        SELECT id, account_id, name, key_prefix, key_hash, status,
               created_by_user_id, created_at, updated_at, last_used_at,
               revoked_at, revoked_by_user_id, rotated_from_key_id,
               expires_at, metadata
        FROM account_api_keys
        WHERE key_prefix = $1
          AND status = 'active'
          AND (expires_at IS NULL OR expires_at > now())
      `,
      [keyPrefix],
    );

    return result.rows[0] ? mapAccountApiKey(result.rows[0]) : null;
  }

  async markLastUsed(
    client: DbClient,
    keyId: string,
    usedAt: string,
  ): Promise<void> {
    await client.query(
      `
        UPDATE account_api_keys
        SET last_used_at = $2::timestamptz,
            updated_at = now()
        WHERE id = $1::uuid
      `,
      [keyId, usedAt],
    );
  }

  async revoke(
    client: DbClient,
    input: {
      accountId: string;
      keyId: string;
      revokedByUserId: string;
      revokedAt: string;
    },
  ): Promise<AccountApiKeyRecord> {
    const result = await client.query(
      `
        UPDATE account_api_keys
        SET status = 'revoked',
            revoked_at = $3::timestamptz,
            revoked_by_user_id = $4::uuid,
            updated_at = now()
        WHERE id = $1::uuid
          AND account_id = $2::uuid
        RETURNING id, account_id, name, key_prefix, key_hash, status,
                  created_by_user_id, created_at, updated_at, last_used_at,
                  revoked_at, revoked_by_user_id, rotated_from_key_id,
                  expires_at, metadata
      `,
      [input.keyId, input.accountId, input.revokedAt, input.revokedByUserId],
    );

    if (!result.rows[0]) {
      throw new Error('API key not found or already revoked');
    }

    return mapAccountApiKey(result.rows[0]);
  }
}
