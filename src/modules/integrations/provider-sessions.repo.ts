import type { DbClient } from '../../lib/db.js';
import { requireDbIsoString, toDbIsoString } from '../../lib/time.js';
import type { ProviderImportProvider } from './provider-import.types.js';

export type ProviderSessionState =
  | 'not_connected'
  | 'oauth_pending'
  | 'connected'
  | 'reauth_required'
  | 'disconnected_by_user';

export type ProviderSessionRecord = {
  profileId: string;
  provider: ProviderImportProvider;
  state: ProviderSessionState;
  providerAccountId: string | null;
  providerUserId: string | null;
  externalUsername: string | null;
  credentialsJson: Record<string, unknown>;
  stateToken: string | null;
  expiresAt: string | null;
  lastRefreshAt: string | null;
  lastRefreshError: string | null;
  lastImportCompletedAt: string | null;
  disconnectedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function mapProviderSession(row: Record<string, unknown>): ProviderSessionRecord {
  const credentialsJson = (row.credentials_json as Record<string, unknown> | undefined) ?? {};
  return {
    profileId: String(row.profile_id),
    provider: String(row.provider) as ProviderImportProvider,
    state: String(row.state) as ProviderSessionState,
    providerAccountId: typeof row.provider_account_id === 'string' ? row.provider_account_id : null,
    providerUserId: typeof row.provider_user_id === 'string' ? row.provider_user_id : null,
    externalUsername: typeof row.external_username === 'string' ? row.external_username : null,
    credentialsJson,
    stateToken: typeof row.state_token === 'string' ? row.state_token : null,
    expiresAt: toDbIsoString(row.expires_at as Date | string | null | undefined, 'provider_sessions.expires_at'),
    lastRefreshAt: toDbIsoString(row.last_refresh_at as Date | string | null | undefined, 'provider_sessions.last_refresh_at'),
    lastRefreshError: typeof row.last_refresh_error === 'string' ? row.last_refresh_error : null,
    lastImportCompletedAt: toDbIsoString(row.last_import_completed_at as Date | string | null | undefined, 'provider_sessions.last_import_completed_at'),
    disconnectedAt: toDbIsoString(row.disconnected_at as Date | string | null | undefined, 'provider_sessions.disconnected_at'),
    createdAt: requireDbIsoString(row.created_at as Date | string | null | undefined, 'provider_sessions.created_at'),
    updatedAt: requireDbIsoString(row.updated_at as Date | string | null | undefined, 'provider_sessions.updated_at'),
  };
}

export class ProviderSessionsRepository {
  async findByProfileAndProvider(
    client: DbClient,
    profileId: string,
    provider: ProviderImportProvider,
  ): Promise<ProviderSessionRecord | null> {
    const result = await client.query(
      `
        SELECT profile_id, provider, state, provider_account_id, provider_user_id, external_username,
               credentials_json, state_token, expires_at, last_refresh_at, last_refresh_error,
               last_import_completed_at, disconnected_at, created_at, updated_at
        FROM provider_sessions
        WHERE profile_id = $1::uuid AND provider = $2
      `,
      [profileId, provider],
    );
    return result.rows[0] ? mapProviderSession(result.rows[0]) : null;
  }

  async listForProfile(client: DbClient, profileId: string): Promise<ProviderSessionRecord[]> {
    const result = await client.query(
      `
        SELECT profile_id, provider, state, provider_account_id, provider_user_id, external_username,
               credentials_json, state_token, expires_at, last_refresh_at, last_refresh_error,
               last_import_completed_at, disconnected_at, created_at, updated_at
        FROM provider_sessions
        WHERE profile_id = $1::uuid
        ORDER BY provider ASC
      `,
      [profileId],
    );
    return result.rows.map((row) => mapProviderSession(row));
  }

  async upsertPending(client: DbClient, params: {
    profileId: string;
    provider: ProviderImportProvider;
    providerAccountId: string;
    stateToken: string;
    expiresAt: string;
    credentialsJson: Record<string, unknown>;
  }): Promise<ProviderSessionRecord> {
    const result = await client.query(
      `
        INSERT INTO provider_sessions (
          profile_id,
          provider,
          state,
          provider_account_id,
          credentials_json,
          state_token,
          expires_at,
          updated_at
        )
        VALUES ($1::uuid, $2, 'oauth_pending', $3::uuid, $4::jsonb, $5, $6::timestamptz, now())
        ON CONFLICT (profile_id, provider)
        DO UPDATE SET
          state = 'oauth_pending',
          provider_account_id = EXCLUDED.provider_account_id,
          provider_user_id = null,
          external_username = null,
          credentials_json = EXCLUDED.credentials_json,
          state_token = EXCLUDED.state_token,
          expires_at = EXCLUDED.expires_at,
          last_refresh_at = null,
          last_refresh_error = null,
          disconnected_at = null,
          updated_at = now()
        RETURNING profile_id, provider, state, provider_account_id, provider_user_id, external_username,
                  credentials_json, state_token, expires_at, last_refresh_at, last_refresh_error,
                  last_import_completed_at, disconnected_at, created_at, updated_at
      `,
      [
        params.profileId,
        params.provider,
        params.providerAccountId,
        JSON.stringify(params.credentialsJson),
        params.stateToken,
        params.expiresAt,
      ],
    );
    return mapProviderSession(result.rows[0]);
  }

  async markConnected(client: DbClient, params: {
    profileId: string;
    provider: ProviderImportProvider;
    providerAccountId: string;
    providerUserId: string | null;
    externalUsername: string | null;
    credentialsJson: Record<string, unknown>;
    connectedAt: string;
  }): Promise<ProviderSessionRecord> {
    const result = await client.query(
      `
        INSERT INTO provider_sessions (
          profile_id,
          provider,
          state,
          provider_account_id,
          provider_user_id,
          external_username,
          credentials_json,
          last_refresh_at,
          last_refresh_error,
          last_import_completed_at,
          disconnected_at,
          updated_at
        )
        VALUES ($1::uuid, $2, 'connected', $3::uuid, $4, $5, $6::jsonb, $7::timestamptz, null, $8::timestamptz, null, now())
        ON CONFLICT (profile_id, provider)
        DO UPDATE SET
          state = 'connected',
          provider_account_id = EXCLUDED.provider_account_id,
          provider_user_id = EXCLUDED.provider_user_id,
          external_username = EXCLUDED.external_username,
          credentials_json = EXCLUDED.credentials_json,
          state_token = null,
          expires_at = null,
          last_refresh_at = EXCLUDED.last_refresh_at,
          last_refresh_error = null,
          last_import_completed_at = EXCLUDED.last_import_completed_at,
          disconnected_at = null,
          updated_at = now()
        RETURNING profile_id, provider, state, provider_account_id, provider_user_id, external_username,
                  credentials_json, state_token, expires_at, last_refresh_at, last_refresh_error,
                  last_import_completed_at, disconnected_at, created_at, updated_at
      `,
      [
        params.profileId,
        params.provider,
        params.providerAccountId,
        params.providerUserId,
        params.externalUsername,
        JSON.stringify(params.credentialsJson),
        params.connectedAt,
        params.credentialsJson.lastImportCompletedAt ?? null,
      ],
    );
    return mapProviderSession(result.rows[0]);
  }

  async markReauthRequired(client: DbClient, params: {
    profileId: string;
    provider: ProviderImportProvider;
    providerAccountId?: string | null;
    providerUserId?: string | null;
    externalUsername?: string | null;
    credentialsJson: Record<string, unknown>;
    lastRefreshAt?: string | null;
    lastRefreshError?: string | null;
    lastImportCompletedAt?: string | null;
  }): Promise<ProviderSessionRecord> {
    const result = await client.query(
      `
        INSERT INTO provider_sessions (
          profile_id,
          provider,
          state,
          provider_account_id,
          provider_user_id,
          external_username,
          credentials_json,
          state_token,
          expires_at,
          last_refresh_at,
          last_refresh_error,
          last_import_completed_at,
          disconnected_at,
          updated_at
        )
        VALUES ($1::uuid, $2, 'reauth_required', $3::uuid, $4, $5, $6::jsonb, null, null, $7::timestamptz, $8, $9::timestamptz, null, now())
        ON CONFLICT (profile_id, provider)
        DO UPDATE SET
          state = 'reauth_required',
          provider_account_id = EXCLUDED.provider_account_id,
          provider_user_id = COALESCE(EXCLUDED.provider_user_id, provider_sessions.provider_user_id),
          external_username = COALESCE(EXCLUDED.external_username, provider_sessions.external_username),
          credentials_json = EXCLUDED.credentials_json,
          state_token = null,
          expires_at = null,
          last_refresh_at = EXCLUDED.last_refresh_at,
          last_refresh_error = EXCLUDED.last_refresh_error,
          last_import_completed_at = COALESCE(EXCLUDED.last_import_completed_at, provider_sessions.last_import_completed_at),
          disconnected_at = null,
          updated_at = now()
        RETURNING profile_id, provider, state, provider_account_id, provider_user_id, external_username,
                  credentials_json, state_token, expires_at, last_refresh_at, last_refresh_error,
                  last_import_completed_at, disconnected_at, created_at, updated_at
      `,
      [
        params.profileId,
        params.provider,
        params.providerAccountId ?? null,
        params.providerUserId ?? null,
        params.externalUsername ?? null,
        JSON.stringify(params.credentialsJson),
        params.lastRefreshAt ?? null,
        params.lastRefreshError ?? null,
        params.lastImportCompletedAt ?? null,
      ],
    );
    return mapProviderSession(result.rows[0]);
  }

  async markDisconnected(client: DbClient, params: {
    profileId: string;
    provider: ProviderImportProvider;
    disconnectedAt: string;
  }): Promise<ProviderSessionRecord> {
    const result = await client.query(
      `
        INSERT INTO provider_sessions (
          profile_id,
          provider,
          state,
          credentials_json,
          disconnected_at,
          updated_at
        )
        VALUES ($1::uuid, $2, 'disconnected_by_user', '{}'::jsonb, $3::timestamptz, now())
        ON CONFLICT (profile_id, provider)
        DO UPDATE SET
          state = 'disconnected_by_user',
          provider_account_id = null,
          provider_user_id = null,
          external_username = null,
          credentials_json = '{}'::jsonb,
          state_token = null,
          expires_at = null,
          last_refresh_at = null,
          last_refresh_error = null,
          disconnected_at = EXCLUDED.disconnected_at,
          updated_at = now()
        RETURNING profile_id, provider, state, provider_account_id, provider_user_id, external_username,
                  credentials_json, state_token, expires_at, last_refresh_at, last_refresh_error,
                  last_import_completed_at, disconnected_at, created_at, updated_at
      `,
      [params.profileId, params.provider, params.disconnectedAt],
    );
    return mapProviderSession(result.rows[0]);
  }

  async touchImportCompleted(client: DbClient, params: {
    profileId: string;
    provider: ProviderImportProvider;
    completedAt: string;
    importJobId: string;
  }): Promise<ProviderSessionRecord | null> {
    const result = await client.query(
      `
        UPDATE provider_sessions
        SET last_import_completed_at = $3::timestamptz,
            credentials_json = jsonb_strip_nulls(credentials_json || jsonb_build_object(
              'lastImportCompletedAt', $3,
              'lastImportJobId', $4
            )),
            updated_at = now()
        WHERE profile_id = $1::uuid AND provider = $2
        RETURNING profile_id, provider, state, provider_account_id, provider_user_id, external_username,
                  credentials_json, state_token, expires_at, last_refresh_at, last_refresh_error,
                  last_import_completed_at, disconnected_at, created_at, updated_at
      `,
      [params.profileId, params.provider, params.completedAt, params.importJobId],
    );
    return result.rows[0] ? mapProviderSession(result.rows[0]) : null;
  }
}
