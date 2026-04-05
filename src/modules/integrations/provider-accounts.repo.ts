import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../lib/db.js';
import { requireDbIsoString, toDbIsoString } from '../../lib/time.js';
import type { ProviderAccountStatus, ProviderImportProvider } from './provider-import.types.js';

export type ProviderAccountRecord = {
  id: string;
  profileId: string;
  provider: ProviderImportProvider;
  status: ProviderAccountStatus;
  stateToken: string | null;
  providerUserId: string | null;
  externalUsername: string | null;
  credentialsJson: Record<string, unknown>;
  createdByUserId: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  connectedAt: string | null;
  updatedAt: string;
};

export type ProviderAccountAdminRecord = ProviderAccountRecord & {
  accountId: string;
  accessTokenExpiresAt: string | null;
  lastRefreshAt: string | null;
  lastRefreshError: string | null;
  lastImportJobId: string | null;
  lastImportCompletedAt: string | null;
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
};

function mapProviderAccount(row: Record<string, unknown>): ProviderAccountRecord {
  const credentialsJson = (row.credentials_json as Record<string, unknown> | undefined) ?? {};
  return {
    id: String(row.id),
    profileId: String(row.profile_id),
    provider: String(row.provider) as ProviderImportProvider,
    status: String(row.status) as ProviderAccountStatus,
    stateToken: typeof row.state_token === 'string' ? row.state_token : null,
    providerUserId: typeof row.provider_user_id === 'string' ? row.provider_user_id : null,
    externalUsername: typeof row.external_username === 'string' ? row.external_username : null,
    credentialsJson,
    createdByUserId: String(row.created_by_user_id),
    expiresAt: toDbIsoString(row.expires_at as Date | string | null | undefined, 'provider_accounts.expires_at'),
    lastUsedAt: toDbIsoString(row.last_used_at as Date | string | null | undefined, 'provider_accounts.last_used_at'),
    createdAt: requireDbIsoString(row.created_at as Date | string | null | undefined, 'provider_accounts.created_at'),
    connectedAt: typeof credentialsJson.connectedAt === 'string'
      ? toDbIsoString(credentialsJson.connectedAt, 'provider_accounts.credentials_json.connectedAt')
      : null,
    updatedAt: requireDbIsoString(row.updated_at as Date | string | null | undefined, 'provider_accounts.updated_at'),
  };
}

export class ProviderAccountsRepository {
  async createPending(client: DbClient, params: {
    profileId: string;
    provider: ProviderImportProvider;
    createdByUserId: string;
    stateToken?: string;
    credentialsJson?: Record<string, unknown>;
    expiresAt?: string | null;
  }): Promise<ProviderAccountRecord> {
    const result = await client.query(
      `
        INSERT INTO provider_accounts (
          profile_id,
          provider,
          status,
          state_token,
          credentials_json,
          created_by_user_id,
          expires_at
        )
        VALUES ($1::uuid, $2, 'pending', $3, $4::jsonb, $5::uuid, $6::timestamptz)
        RETURNING id, profile_id, provider, status, state_token, provider_user_id, external_username,
                  credentials_json, created_by_user_id, expires_at, last_used_at, created_at, updated_at
      `,
      [
        params.profileId,
        params.provider,
        params.stateToken ?? randomUUID(),
        JSON.stringify(params.credentialsJson ?? {}),
        params.createdByUserId,
        params.expiresAt ?? null,
      ],
    );
    return mapProviderAccount(result.rows[0]);
  }

  async findPendingByStateToken(
    client: DbClient,
    provider: ProviderImportProvider,
    stateToken: string,
  ): Promise<ProviderAccountRecord | null> {
    const result = await client.query(
      `
        SELECT id, profile_id, provider, status, state_token, provider_user_id, external_username,
               credentials_json, created_by_user_id, expires_at, last_used_at, created_at, updated_at
        FROM provider_accounts
        WHERE provider = $1 AND state_token = $2 AND status = 'pending'
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [provider, stateToken],
    );
    return result.rows[0] ? mapProviderAccount(result.rows[0]) : null;
  }

  async findLatestConnectedForProfile(
    client: DbClient,
    profileId: string,
    provider: ProviderImportProvider,
  ): Promise<ProviderAccountRecord | null> {
    const result = await client.query(
      `
        SELECT id, profile_id, provider, status, state_token, provider_user_id, external_username,
               credentials_json, created_by_user_id, expires_at, last_used_at, created_at, updated_at
        FROM provider_accounts
        WHERE profile_id = $1::uuid AND provider = $2 AND status = 'connected'
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 1
      `,
      [profileId, provider],
    );
    return result.rows[0] ? mapProviderAccount(result.rows[0]) : null;
  }

  async findById(client: DbClient, providerAccountId: string): Promise<ProviderAccountRecord | null> {
    const result = await client.query(
      `
        SELECT id, profile_id, provider, status, state_token, provider_user_id, external_username,
               credentials_json, created_by_user_id, expires_at, last_used_at, created_at, updated_at
        FROM provider_accounts
        WHERE id = $1::uuid
      `,
      [providerAccountId],
    );
    return result.rows[0] ? mapProviderAccount(result.rows[0]) : null;
  }

  async markConnected(client: DbClient, params: {
    providerAccountId: string;
    providerUserId?: string | null;
    externalUsername?: string | null;
    credentialsJson: Record<string, unknown>;
    connectedAt: string;
  }): Promise<ProviderAccountRecord> {
    const result = await client.query(
      `
        UPDATE provider_accounts
        SET status = 'connected',
            state_token = null,
            provider_user_id = $2,
            external_username = $3,
            credentials_json = $4::jsonb,
            expires_at = null,
            last_used_at = $5::timestamptz,
            updated_at = now()
        WHERE id = $1::uuid
        RETURNING id, profile_id, provider, status, state_token, provider_user_id, external_username,
                  credentials_json, created_by_user_id, expires_at, last_used_at, created_at, updated_at
      `,
      [
        params.providerAccountId,
        params.providerUserId ?? null,
        params.externalUsername ?? null,
        JSON.stringify(params.credentialsJson),
        params.connectedAt,
      ],
    );
    return mapProviderAccount(result.rows[0]);
  }

  async markExpired(client: DbClient, providerAccountId: string): Promise<void> {
    await client.query(
      `
        UPDATE provider_accounts
        SET status = 'expired', state_token = null, updated_at = now()
        WHERE id = $1::uuid AND status = 'pending'
      `,
      [providerAccountId],
    );
  }

  async revokeProviderAccount(client: DbClient, params: {
    providerAccountId: string;
    credentialsJson?: Record<string, unknown>;
    lastUsedAt?: string | null;
  }): Promise<ProviderAccountRecord | null> {
    const result = await client.query(
      `
        UPDATE provider_accounts
        SET status = 'revoked',
            state_token = null,
            expires_at = null,
            credentials_json = CASE WHEN $2::jsonb IS NULL THEN credentials_json ELSE $2::jsonb END,
            last_used_at = COALESCE($3::timestamptz, last_used_at),
            updated_at = now()
        WHERE id = $1::uuid
          AND status = 'connected'
        RETURNING id, profile_id, provider, status, state_token, provider_user_id, external_username,
                  credentials_json, created_by_user_id, expires_at, last_used_at, created_at, updated_at
      `,
      [
        params.providerAccountId,
        params.credentialsJson ? JSON.stringify(params.credentialsJson) : null,
        params.lastUsedAt ?? null,
      ],
    );
    return result.rows[0] ? mapProviderAccount(result.rows[0]) : null;
  }

  async revokeOtherConnectedForProfile(
    client: DbClient,
    profileId: string,
    keepProviderAccountId: string,
  ): Promise<void> {
    await client.query(
      `
        UPDATE provider_accounts
        SET status = 'revoked', state_token = null, expires_at = null, updated_at = now()
        WHERE profile_id = $1::uuid
          AND status = 'connected'
          AND id <> $2::uuid
      `,
      [profileId, keepProviderAccountId],
    );
  }

  async listForProfile(client: DbClient, profileId: string): Promise<ProviderAccountRecord[]> {
    const result = await client.query(
      `
        SELECT id, profile_id, provider, status, state_token, provider_user_id, external_username,
               credentials_json, created_by_user_id, expires_at, last_used_at, created_at, updated_at
        FROM provider_accounts
        WHERE profile_id = $1::uuid
        ORDER BY created_at DESC
      `,
      [profileId],
    );
    return result.rows.map((row) => mapProviderAccount(row));
  }

  async updateConnectedCredentials(client: DbClient, params: {
    providerAccountId: string;
    credentialsJson: Record<string, unknown>;
    providerUserId?: string | null;
    externalUsername?: string | null;
    lastUsedAt?: string | null;
  }): Promise<ProviderAccountRecord> {
    const result = await client.query(
      `
        UPDATE provider_accounts
        SET provider_user_id = COALESCE($2, provider_user_id),
            external_username = COALESCE($3, external_username),
            credentials_json = $4::jsonb,
            last_used_at = COALESCE($5::timestamptz, last_used_at),
            updated_at = now()
        WHERE id = $1::uuid AND status = 'connected'
        RETURNING id, profile_id, provider, status, state_token, provider_user_id, external_username,
                  credentials_json, created_by_user_id, expires_at, last_used_at, created_at, updated_at
      `,
      [
        params.providerAccountId,
        params.providerUserId ?? null,
        params.externalUsername ?? null,
        JSON.stringify(params.credentialsJson),
        params.lastUsedAt ?? null,
      ],
    );
    return mapProviderAccount(result.rows[0]);
  }

  async listAdminProviderAccounts(client: DbClient, filters?: {
    provider?: ProviderImportProvider | null;
    status?: ProviderAccountStatus | null;
    expiringBefore?: string | null;
    refreshFailuresOnly?: boolean;
    limit?: number;
  }): Promise<ProviderAccountAdminRecord[]> {
    const result = await client.query(
      `
        SELECT pa.id, pa.profile_id, pa.provider, pa.status, pa.state_token, pa.provider_user_id, pa.external_username,
               pa.credentials_json, pa.created_by_user_id, pa.expires_at, pa.last_used_at, pa.created_at, pa.updated_at,
               pg.owner_user_id AS account_id,
               NULLIF(credentials_json ->> 'accessTokenExpiresAt', '') AS access_token_expires_at,
               NULLIF(credentials_json ->> 'lastRefreshAt', '') AS last_refresh_at,
               NULLIF(credentials_json ->> 'lastRefreshError', '') AS last_refresh_error,
               NULLIF(credentials_json ->> 'lastImportJobId', '') AS last_import_job_id,
               NULLIF(credentials_json ->> 'lastImportCompletedAt', '') AS last_import_completed_at,
               CASE WHEN COALESCE(credentials_json ->> 'accessToken', '') <> '' THEN true ELSE false END AS has_access_token,
               CASE WHEN COALESCE(credentials_json ->> 'refreshToken', '') <> '' THEN true ELSE false END AS has_refresh_token
        FROM provider_accounts pa
        INNER JOIN profiles p ON p.id = pa.profile_id
        INNER JOIN profile_groups pg ON pg.id = p.profile_group_id
        WHERE ($1::text IS NULL OR pa.provider = $1)
          AND ($2::text IS NULL OR pa.status = $2)
          AND ($3::timestamptz IS NULL OR NULLIF(credentials_json ->> 'accessTokenExpiresAt', '')::timestamptz <= $3::timestamptz)
          AND ($4::boolean = false OR NULLIF(credentials_json ->> 'lastRefreshError', '') IS NOT NULL)
        ORDER BY pa.updated_at DESC, pa.created_at DESC
        LIMIT $5
      `,
      [
        filters?.provider ?? null,
        filters?.status ?? null,
        filters?.expiringBefore ?? null,
        filters?.refreshFailuresOnly ?? false,
        filters?.limit ?? 100,
      ],
    );

    return result.rows.map((row) => ({
      ...mapProviderAccount(row),
      accountId: String(row.account_id),
      accessTokenExpiresAt: toDbIsoString(row.access_token_expires_at as Date | string | null | undefined, 'provider_accounts.access_token_expires_at'),
      lastRefreshAt: toDbIsoString(row.last_refresh_at as Date | string | null | undefined, 'provider_accounts.last_refresh_at'),
      lastRefreshError: typeof row.last_refresh_error === 'string' ? row.last_refresh_error : null,
      lastImportJobId: typeof row.last_import_job_id === 'string' ? row.last_import_job_id : null,
      lastImportCompletedAt: toDbIsoString(row.last_import_completed_at as Date | string | null | undefined, 'provider_accounts.last_import_completed_at'),
      hasAccessToken: Boolean(row.has_access_token),
      hasRefreshToken: Boolean(row.has_refresh_token),
    }));
  }
}
