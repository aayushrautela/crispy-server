import type { DbClient } from '../../lib/db.js';
import { requireDbIsoString, toDbIsoString } from '../../lib/time.js';

export type AppLoginHandoffRecord = {
  id: string;
  accountId: string;
  codeHash: string;
  codePreview: string;
  returnUri: string | null;
  expiresAt: string;
  consumedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function mapAppLoginHandoff(row: Record<string, unknown>): AppLoginHandoffRecord {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    codeHash: String(row.code_hash),
    codePreview: String(row.code_preview),
    returnUri: typeof row.return_uri === 'string' ? row.return_uri : null,
    expiresAt: requireDbIsoString(row.expires_at as Date | string | null | undefined, 'app_login_handoff_codes.expires_at'),
    consumedAt: toDbIsoString(row.consumed_at as Date | string | null | undefined, 'app_login_handoff_codes.consumed_at'),
    createdAt: requireDbIsoString(row.created_at as Date | string | null | undefined, 'app_login_handoff_codes.created_at'),
    updatedAt: requireDbIsoString(row.updated_at as Date | string | null | undefined, 'app_login_handoff_codes.updated_at'),
  };
}

export class AppLoginHandoffRepository {
  async create(client: DbClient, params: {
    accountId: string;
    codeHash: string;
    codePreview: string;
    returnUri: string | null;
    expiresAt: string;
  }): Promise<AppLoginHandoffRecord> {
    const result = await client.query(
      `
        INSERT INTO private.app_login_handoff_codes (
          account_id,
          code_hash,
          code_preview,
          return_uri,
          expires_at
        )
        VALUES ($1::uuid, $2, $3, $4, $5::timestamptz)
        RETURNING id, account_id, code_hash, code_preview, return_uri,
                  expires_at, consumed_at, created_at, updated_at
      `,
      [params.accountId, params.codeHash, params.codePreview, params.returnUri, params.expiresAt],
    );

    return mapAppLoginHandoff(result.rows[0]);
  }

  async consumeActiveByHash(client: DbClient, codeHash: string): Promise<AppLoginHandoffRecord | null> {
    const result = await client.query(
      `
        UPDATE private.app_login_handoff_codes
        SET consumed_at = now(), updated_at = now()
        WHERE id = (
          SELECT id
          FROM private.app_login_handoff_codes
          WHERE code_hash = $1
            AND consumed_at IS NULL
            AND expires_at > now()
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        RETURNING id, account_id, code_hash, code_preview, return_uri,
                  expires_at, consumed_at, created_at, updated_at
      `,
      [codeHash],
    );

    return result.rows[0] ? mapAppLoginHandoff(result.rows[0]) : null;
  }
}
