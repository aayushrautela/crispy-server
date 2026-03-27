import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../lib/db.js';
import { requireDbIsoString, toDbIsoString } from '../../lib/time.js';
import type { ProviderImportConnectionStatus, ProviderImportProvider } from './provider-import.types.js';

export type ProviderImportConnectionRecord = {
  id: string;
  profileId: string;
  provider: ProviderImportProvider;
  status: ProviderImportConnectionStatus;
  stateToken: string | null;
  providerUserId: string | null;
  externalUsername: string | null;
  credentialsJson: Record<string, unknown>;
  createdByUserId: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProviderImportConnectionAdminRecord = ProviderImportConnectionRecord & {
  accountId: string;
  accessTokenExpiresAt: string | null;
  lastRefreshAt: string | null;
  lastRefreshError: string | null;
  lastImportJobId: string | null;
  lastImportCompletedAt: string | null;
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
};

function mapConnection(row: Record<string, unknown>): ProviderImportConnectionRecord {
  return {
    id: String(row.id),
    profileId: String(row.profile_id),
    provider: String(row.provider) as ProviderImportProvider,
    status: String(row.status) as ProviderImportConnectionStatus,
    stateToken: typeof row.state_token === 'string' ? row.state_token : null,
    providerUserId: typeof row.provider_user_id === 'string' ? row.provider_user_id : null,
    externalUsername: typeof row.external_username === 'string' ? row.external_username : null,
    credentialsJson: (row.credentials_json as Record<string, unknown> | undefined) ?? {},
    createdByUserId: String(row.created_by_user_id),
    expiresAt: toDbIsoString(row.expires_at as Date | string | null | undefined, 'provider_import_connections.expires_at'),
    lastUsedAt: toDbIsoString(row.last_used_at as Date | string | null | undefined, 'provider_import_connections.last_used_at'),
    createdAt: requireDbIsoString(row.created_at as Date | string | null | undefined, 'provider_import_connections.created_at'),
    updatedAt: requireDbIsoString(row.updated_at as Date | string | null | undefined, 'provider_import_connections.updated_at'),
  };
}

export class ProviderImportConnectionsRepository {
  async createPending(client: DbClient, params: {
    profileId: string;
    provider: ProviderImportProvider;
    createdByUserId: string;
    stateToken?: string;
    credentialsJson?: Record<string, unknown>;
    expiresAt?: string | null;
  }): Promise<ProviderImportConnectionRecord> {
    const result = await client.query(
      `
        INSERT INTO provider_import_connections (
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
    return mapConnection(result.rows[0]);
  }

  async findPendingByStateToken(
    client: DbClient,
    provider: ProviderImportProvider,
    stateToken: string,
  ): Promise<ProviderImportConnectionRecord | null> {
    const result = await client.query(
      `
        SELECT id, profile_id, provider, status, state_token, provider_user_id, external_username,
               credentials_json, created_by_user_id, expires_at, last_used_at, created_at, updated_at
        FROM provider_import_connections
        WHERE provider = $1 AND state_token = $2 AND status = 'pending'
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [provider, stateToken],
    );
    return result.rows[0] ? mapConnection(result.rows[0]) : null;
  }

  async findLatestConnectedForProfile(
    client: DbClient,
    profileId: string,
    provider: ProviderImportProvider,
  ): Promise<ProviderImportConnectionRecord | null> {
    const result = await client.query(
      `
        SELECT id, profile_id, provider, status, state_token, provider_user_id, external_username,
               credentials_json, created_by_user_id, expires_at, last_used_at, created_at, updated_at
        FROM provider_import_connections
        WHERE profile_id = $1::uuid AND provider = $2 AND status = 'connected'
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 1
      `,
      [profileId, provider],
    );
    return result.rows[0] ? mapConnection(result.rows[0]) : null;
  }

  async findById(client: DbClient, connectionId: string): Promise<ProviderImportConnectionRecord | null> {
    const result = await client.query(
      `
        SELECT id, profile_id, provider, status, state_token, provider_user_id, external_username,
               credentials_json, created_by_user_id, expires_at, last_used_at, created_at, updated_at
        FROM provider_import_connections
        WHERE id = $1::uuid
      `,
      [connectionId],
    );
    return result.rows[0] ? mapConnection(result.rows[0]) : null;
  }

  async markConnected(client: DbClient, params: {
    connectionId: string;
    providerUserId?: string | null;
    externalUsername?: string | null;
    credentialsJson: Record<string, unknown>;
    connectedAt: string;
  }): Promise<ProviderImportConnectionRecord> {
    const result = await client.query(
      `
        UPDATE provider_import_connections
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
        params.connectionId,
        params.providerUserId ?? null,
        params.externalUsername ?? null,
        JSON.stringify(params.credentialsJson),
        params.connectedAt,
      ],
    );
    return mapConnection(result.rows[0]);
  }

  async markExpired(client: DbClient, connectionId: string): Promise<void> {
    await client.query(
      `
        UPDATE provider_import_connections
        SET status = 'expired', state_token = null, updated_at = now()
        WHERE id = $1::uuid AND status = 'pending'
      `,
      [connectionId],
    );
  }

  async revokeConnection(client: DbClient, params: {
    connectionId: string;
    credentialsJson?: Record<string, unknown>;
    lastUsedAt?: string | null;
  }): Promise<ProviderImportConnectionRecord | null> {
    const result = await client.query(
      `
        UPDATE provider_import_connections
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
        params.connectionId,
        params.credentialsJson ? JSON.stringify(params.credentialsJson) : null,
        params.lastUsedAt ?? null,
      ],
    );
    return result.rows[0] ? mapConnection(result.rows[0]) : null;
  }

  async revokeOtherConnectedForProfile(
    client: DbClient,
    profileId: string,
    provider: ProviderImportProvider,
    keepConnectionId: string,
  ): Promise<void> {
    await client.query(
      `
        UPDATE provider_import_connections
        SET status = 'revoked', state_token = null, updated_at = now()
        WHERE profile_id = $1::uuid
          AND provider = $2
          AND status = 'connected'
          AND id <> $3::uuid
      `,
      [profileId, provider, keepConnectionId],
    );
  }

  async listForProfile(client: DbClient, profileId: string): Promise<ProviderImportConnectionRecord[]> {
    const result = await client.query(
      `
        SELECT id, profile_id, provider, status, state_token, provider_user_id, external_username,
               credentials_json, created_by_user_id, expires_at, last_used_at, created_at, updated_at
        FROM provider_import_connections
        WHERE profile_id = $1::uuid
        ORDER BY created_at DESC
      `,
      [profileId],
    );
    return result.rows.map((row) => mapConnection(row));
  }

  async updateConnectedCredentials(client: DbClient, params: {
    connectionId: string;
    credentialsJson: Record<string, unknown>;
    providerUserId?: string | null;
    externalUsername?: string | null;
    lastUsedAt?: string | null;
  }): Promise<ProviderImportConnectionRecord> {
    const result = await client.query(
      `
        UPDATE provider_import_connections
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
        params.connectionId,
        params.providerUserId ?? null,
        params.externalUsername ?? null,
        JSON.stringify(params.credentialsJson),
        params.lastUsedAt ?? null,
      ],
    );
    return mapConnection(result.rows[0]);
  }

  async listAdminConnections(client: DbClient, filters?: {
    provider?: ProviderImportProvider | null;
    status?: ProviderImportConnectionStatus | null;
    expiringBefore?: string | null;
    refreshFailuresOnly?: boolean;
    limit?: number;
  }): Promise<ProviderImportConnectionAdminRecord[]> {
    const result = await client.query(
      `
        SELECT pic.id, pic.profile_id, pic.provider, pic.status, pic.state_token, pic.provider_user_id, pic.external_username,
               pic.credentials_json, pic.created_by_user_id, pic.expires_at, pic.last_used_at, pic.created_at, pic.updated_at,
               pg.owner_user_id AS account_id,
               NULLIF(credentials_json ->> 'accessTokenExpiresAt', '') AS access_token_expires_at,
               NULLIF(credentials_json ->> 'lastRefreshAt', '') AS last_refresh_at,
               NULLIF(credentials_json ->> 'lastRefreshError', '') AS last_refresh_error,
               NULLIF(credentials_json ->> 'lastImportJobId', '') AS last_import_job_id,
               NULLIF(credentials_json ->> 'lastImportCompletedAt', '') AS last_import_completed_at,
               CASE WHEN COALESCE(credentials_json ->> 'accessToken', '') <> '' THEN true ELSE false END AS has_access_token,
               CASE WHEN COALESCE(credentials_json ->> 'refreshToken', '') <> '' THEN true ELSE false END AS has_refresh_token
        FROM provider_import_connections pic
        INNER JOIN profiles p ON p.id = pic.profile_id
        INNER JOIN profile_groups pg ON pg.id = p.profile_group_id
        WHERE ($1::text IS NULL OR pic.provider = $1)
          AND ($2::text IS NULL OR pic.status = $2)
          AND ($3::timestamptz IS NULL OR NULLIF(credentials_json ->> 'accessTokenExpiresAt', '')::timestamptz <= $3::timestamptz)
          AND ($4::boolean = false OR NULLIF(credentials_json ->> 'lastRefreshError', '') IS NOT NULL)
        ORDER BY pic.updated_at DESC, pic.created_at DESC
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
      ...mapConnection(row),
      accountId: String(row.account_id),
      accessTokenExpiresAt: toDbIsoString(row.access_token_expires_at as Date | string | null | undefined, 'provider_import_connections.access_token_expires_at'),
      lastRefreshAt: toDbIsoString(row.last_refresh_at as Date | string | null | undefined, 'provider_import_connections.last_refresh_at'),
      lastRefreshError: typeof row.last_refresh_error === 'string' ? row.last_refresh_error : null,
      lastImportJobId: typeof row.last_import_job_id === 'string' ? row.last_import_job_id : null,
      lastImportCompletedAt: toDbIsoString(row.last_import_completed_at as Date | string | null | undefined, 'provider_import_connections.last_import_completed_at'),
      hasAccessToken: Boolean(row.has_access_token),
      hasRefreshToken: Boolean(row.has_refresh_token),
    }));
  }
}
