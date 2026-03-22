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
    expiresAt?: string | null;
  }): Promise<ProviderImportConnectionRecord> {
    const result = await client.query(
      `
        INSERT INTO provider_import_connections (
          profile_id,
          provider,
          status,
          state_token,
          created_by_user_id,
          expires_at
        )
        VALUES ($1::uuid, $2, 'pending', $3, $4::uuid, $5::timestamptz)
        RETURNING id, profile_id, provider, status, state_token, provider_user_id, external_username,
                  credentials_json, created_by_user_id, expires_at, last_used_at, created_at, updated_at
      `,
      [params.profileId, params.provider, randomUUID(), params.createdByUserId, params.expiresAt ?? null],
    );
    return mapConnection(result.rows[0]);
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
}
