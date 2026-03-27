import type { DbClient } from '../../lib/db.js';
import { requireDbIsoString, toDbIsoString } from '../../lib/time.js';
import type { AuthScope } from './auth.types.js';

export type PersonalAccessTokenRecord = {
  id: string;
  userId: string;
  name: string;
  tokenHash: string;
  tokenPreview: string;
  scopes: AuthScope[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function mapPersonalAccessToken(row: Record<string, unknown>): PersonalAccessTokenRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    name: String(row.name),
    tokenHash: String(row.token_hash),
    tokenPreview: String(row.token_preview),
    scopes: Array.isArray(row.scopes) ? row.scopes.filter((scope): scope is AuthScope => typeof scope === 'string') : [],
    expiresAt: toDbIsoString(row.expires_at as Date | string | null | undefined, 'personal_access_tokens.expires_at'),
    lastUsedAt: toDbIsoString(row.last_used_at as Date | string | null | undefined, 'personal_access_tokens.last_used_at'),
    revokedAt: toDbIsoString(row.revoked_at as Date | string | null | undefined, 'personal_access_tokens.revoked_at'),
    createdAt: requireDbIsoString(row.created_at as Date | string | null | undefined, 'personal_access_tokens.created_at'),
    updatedAt: requireDbIsoString(row.updated_at as Date | string | null | undefined, 'personal_access_tokens.updated_at'),
  };
}

export class PersonalAccessTokenRepository {
  async create(client: DbClient, params: {
    userId: string;
    name: string;
    tokenHash: string;
    tokenPreview: string;
    scopes: AuthScope[];
    expiresAt?: string | null;
  }): Promise<PersonalAccessTokenRecord> {
    const result = await client.query(
      `
        INSERT INTO personal_access_tokens (
          user_id,
          name,
          token_hash,
          token_preview,
          scopes,
          expires_at
        )
        VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6::timestamptz)
        RETURNING id, user_id, name, token_hash, token_preview, scopes,
                  expires_at, last_used_at, revoked_at, created_at, updated_at
      `,
      [params.userId, params.name, params.tokenHash, params.tokenPreview, JSON.stringify(params.scopes), params.expiresAt ?? null],
    );

    return mapPersonalAccessToken(result.rows[0]);
  }

  async findActiveByHash(client: DbClient, tokenHash: string): Promise<PersonalAccessTokenRecord | null> {
    const result = await client.query(
      `
        SELECT id, user_id, name, token_hash, token_preview, scopes,
               expires_at, last_used_at, revoked_at, created_at, updated_at
        FROM personal_access_tokens
        WHERE token_hash = $1
          AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > now())
      `,
      [tokenHash],
    );

    return result.rows[0] ? mapPersonalAccessToken(result.rows[0]) : null;
  }

  async touchLastUsed(client: DbClient, tokenId: string): Promise<void> {
    await client.query(
      `
        UPDATE personal_access_tokens
        SET last_used_at = now(), updated_at = now()
        WHERE id = $1::uuid
      `,
      [tokenId],
    );
  }

  async listForUser(client: DbClient, userId: string): Promise<PersonalAccessTokenRecord[]> {
    const result = await client.query(
      `
        SELECT id, user_id, name, token_hash, token_preview, scopes,
               expires_at, last_used_at, revoked_at, created_at, updated_at
        FROM personal_access_tokens
        WHERE user_id = $1::uuid
        ORDER BY created_at DESC
      `,
      [userId],
    );

    return result.rows.map((row) => mapPersonalAccessToken(row));
  }

  async revoke(client: DbClient, userId: string, tokenId: string): Promise<PersonalAccessTokenRecord | null> {
    const result = await client.query(
      `
        UPDATE personal_access_tokens
        SET revoked_at = now(), updated_at = now()
        WHERE id = $1::uuid
          AND user_id = $2::uuid
          AND revoked_at IS NULL
        RETURNING id, user_id, name, token_hash, token_preview, scopes,
                  expires_at, last_used_at, revoked_at, created_at, updated_at
      `,
      [tokenId, userId],
    );

    return result.rows[0] ? mapPersonalAccessToken(result.rows[0]) : null;
  }

  async revokeAllForUser(client: DbClient, userId: string): Promise<number> {
    const result = await client.query(
      `
        UPDATE personal_access_tokens
        SET revoked_at = now(), updated_at = now()
        WHERE user_id = $1::uuid
          AND revoked_at IS NULL
      `,
      [userId],
    );

    return result.rowCount ?? 0;
  }
}
