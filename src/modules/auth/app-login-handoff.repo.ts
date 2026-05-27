import type { DbClient } from '../../lib/db.js';
import { requireDbIsoString, toDbIsoString } from '../../lib/time.js';

export type AppLoginHandoffRecord = {
  id: string;
  accountId: string;
  codeHash: string;
  codePreview: string;
  clientId: string;
  returnUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  state: string;
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
    clientId: String(row.client_id),
    returnUri: String(row.return_uri),
    codeChallenge: String(row.code_challenge),
    codeChallengeMethod: String(row.code_challenge_method),
    state: String(row.state),
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
    clientId: string;
    returnUri: string;
    codeChallenge: string;
    codeChallengeMethod: string;
    state: string;
    expiresAt: string;
  }): Promise<AppLoginHandoffRecord> {
    const result = await client.query(
      `
        INSERT INTO private.app_login_handoff_codes (
          account_id,
          code_hash,
          code_preview,
          client_id,
          return_uri,
          code_challenge,
          code_challenge_method,
          state,
          expires_at
        )
        VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz)
        RETURNING id, account_id, code_hash, code_preview,
                  client_id, return_uri, code_challenge, code_challenge_method, state,
                  expires_at, consumed_at, created_at, updated_at
      `,
      [params.accountId, params.codeHash, params.codePreview, params.clientId, params.returnUri, params.codeChallenge, params.codeChallengeMethod, params.state, params.expiresAt],
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
        RETURNING id, account_id, code_hash, code_preview,
                  client_id, return_uri, code_challenge, code_challenge_method, state,
                  expires_at, consumed_at, created_at, updated_at
      `,
      [codeHash],
    );

    return result.rows[0] ? mapAppLoginHandoff(result.rows[0]) : null;
  }
}
