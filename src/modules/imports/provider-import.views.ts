import type { ProviderImportConnectionRecord } from './provider-import-connections.repo.js';
import type { ProviderImportJobAdminRecord, ProviderImportJobRecord } from './provider-import-jobs.repo.js';
import type { ProviderImportProvider } from './provider-import.types.js';

export type ProviderImportConnectionView = {
  id: string;
  provider: ProviderImportProvider;
  status: 'pending' | 'connected' | 'expired' | 'revoked';
  providerUserId: string | null;
  externalUsername: string | null;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  lastImportJobId: string | null;
  lastImportCompletedAt: string | null;
};

export type ProviderImportJobView = Omit<ProviderImportJobRecord, 'profileGroupId'>;

export type ProviderImportJobAdminView = Omit<ProviderImportJobAdminRecord, 'profileGroupId'>;

export function mapConnectionView(connection: ProviderImportConnectionRecord): ProviderImportConnectionView {
  const lastImportJobId = asString(connection.credentialsJson.lastImportJobId);
  const lastImportCompletedAt = asIsoString(connection.credentialsJson.lastImportCompletedAt);

  return {
    id: connection.id,
    provider: connection.provider,
    status: connection.status,
    providerUserId: connection.providerUserId,
    externalUsername: connection.externalUsername,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
    lastUsedAt: connection.lastUsedAt,
    lastImportJobId,
    lastImportCompletedAt,
  };
}

export function mapProviderImportJobView(job: ProviderImportJobRecord): ProviderImportJobView {
  const { profileGroupId: _profileGroupId, ...view } = job;
  return view;
}

export function mapProviderImportJobAdminView(job: ProviderImportJobAdminRecord): ProviderImportJobAdminView {
  const { profileGroupId: _profileGroupId, ...view } = job;
  return view;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asIsoString(value: unknown): string | null {
  const text = asString(value);
  if (!text) {
    return null;
  }
  return Number.isNaN(Date.parse(text)) ? null : text;
}
