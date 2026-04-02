import { normalizeIsoString } from '../../lib/time.js';
import type { ProviderAccountRecord } from './provider-accounts.repo.js';
import type { ProviderImportJobAdminRecord, ProviderImportJobRecord } from './provider-import-jobs.repo.js';
import type { ProviderImportProvider } from './provider-import.types.js';

export type ProviderAccountView = {
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

export function mapProviderAccountView(providerAccount: ProviderAccountRecord): ProviderAccountView {
  const lastImportJobId = asString(providerAccount.credentialsJson.lastImportJobId);
  const lastImportCompletedAt = asIsoString(providerAccount.credentialsJson.lastImportCompletedAt);

  return {
    id: providerAccount.id,
    provider: providerAccount.provider,
    status: providerAccount.status,
    providerUserId: providerAccount.providerUserId,
    externalUsername: providerAccount.externalUsername,
    createdAt: providerAccount.createdAt,
    updatedAt: providerAccount.updatedAt,
    lastUsedAt: providerAccount.lastUsedAt,
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
  return normalizeIsoString(text);
}
