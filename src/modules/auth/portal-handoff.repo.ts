import type { DbClient } from '../../lib/db.js';
import { requireDbIsoString, toDbIsoString } from '../../lib/time.js';

export type PortalHandoffRecord = {
  id: string;
  accountId: string;
  codeHash: string;
  codePreview: string;
  redirectPath: string;
  expiresAt: string;
  consumedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function mapPortalHandoff(row: Record<string, unknown>): PortalHandoffRecord {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    codeHash: String(row.code_hash),
    codePreview: String(row.code_preview),
    redirectPath: String(row.redirect_path),
    expiresAt: requireDbIsoString(row.expires_at as Date | string | null | undefined, 'portal_handoff_codes.expires_at'),
    consumedAt: toDbIsoString(row.consumed_at as Date | string | null | undefined, 'portal_handoff_codes.consumed_at'),
    createdAt: requireDbIsoString(row.created_at as Date | string | null | undefined, 'portal_handoff_codes.created_at'),
    updatedAt: requireDbIsoString(row.updated_at as Date | string | null | undefined, 'portal_handoff_codes.updated_at'),
  };
}

export class PortalHandoffRepository {
  async create(client: DbClient, params: {
    accountId: string;
    codeHash: string;
    codePreview: string;
    redirectPath: string;
    expiresAt: string;
  }): Promise<PortalHandoffRecord> {
    const result = await client.query(
      `
        INSERT INTO private.portal_handoff_codes (
          account_id,
          code_hash,
          code_preview,
          redirect_path,
          expires_at
        )
        VALUES ($1::uuid, $2, $3, $4, $5::timestamptz)
        RETURNING id, account_id, code_hash, code_preview,
                  redirect_path, expires_at, consumed_at, created_at, updated_at
      `,
      [params.accountId, params.codeHash, params.codePreview, params.redirectPath, params.expiresAt],
    );

    return mapPortalHandoff(result.rows[0]);
  }

  async consumeActiveByHash(client: DbClient, codeHash: string): Promise<PortalHandoffRecord | null> {
    const result = await client.query(
      `
        UPDATE private.portal_handoff_codes
        SET consumed_at = now(), updated_at = now()
        WHERE id = (
          SELECT id
          FROM private.portal_handoff_codes
          WHERE code_hash = $1
            AND consumed_at IS NULL
            AND expires_at > now()
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        RETURNING id, account_id, code_hash, code_preview,
                  redirect_path, expires_at, consumed_at, created_at, updated_at
      `,
      [codeHash],
    );

    return result.rows[0] ? mapPortalHandoff(result.rows[0]) : null;
  }
}
