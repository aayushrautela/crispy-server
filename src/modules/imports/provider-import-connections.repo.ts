import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../lib/db.js';
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
    expiresAt: typeof row.expires_at === 'string' ? row.expires_at : null,
    lastUsedAt: typeof row.last_used_at === 'string' ? row.last_used_at : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
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
}
