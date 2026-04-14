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

export type ProviderStateConnectionState =
  | 'not_connected'
  | 'pending_authorization'
  | 'connected'
  | 'reauthorization_required';

export type ProviderStatePrimaryAction = 'connect' | 'import' | 'reconnect';

export type ProviderStateView = {
  provider: ProviderImportProvider;
  providerAccountId: string | null;
  connectionState: ProviderStateConnectionState;
  accountStatus: 'pending' | 'connected' | 'expired' | 'revoked' | null;
  primaryAction: ProviderStatePrimaryAction;
  canImport: boolean;
  canReconnect: boolean;
  canDisconnect: boolean;
  externalUsername: string | null;
  statusLabel: string;
  statusMessage: string | null;
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

export function mapProviderStateView(
  provider: ProviderImportProvider,
  providerAccount: ProviderAccountRecord | null,
  nowMs = Date.now(),
): ProviderStateView {
  if (!providerAccount || hasDisconnectedMarker(providerAccount)) {
    return {
      provider,
      providerAccountId: null,
      connectionState: 'not_connected',
      accountStatus: null,
      primaryAction: 'connect',
      canImport: false,
      canReconnect: false,
      canDisconnect: false,
      externalUsername: null,
      statusLabel: 'Not connected',
      statusMessage: `Connect ${providerLabel(provider)} to import watch history.`,
      lastImportCompletedAt: null,
    };
  }

  const lastImportCompletedAt = asIsoString(providerAccount.credentialsJson.lastImportCompletedAt);
  const externalUsername = providerAccount.externalUsername;

  if (providerAccount.status === 'pending') {
    return {
      provider,
      providerAccountId: providerAccount.id,
      connectionState: 'pending_authorization',
      accountStatus: providerAccount.status,
      primaryAction: 'reconnect',
      canImport: false,
      canReconnect: true,
      canDisconnect: true,
      externalUsername,
      statusLabel: 'Authorization pending',
      statusMessage: `Finish ${providerLabel(provider)} authorization in your browser or reconnect to start over.`,
      lastImportCompletedAt,
    };
  }

  if (providerAccount.status === 'connected' && hasUsableAccessToken(providerAccount, nowMs)) {
    return {
      provider,
      providerAccountId: providerAccount.id,
      connectionState: 'connected',
      accountStatus: providerAccount.status,
      primaryAction: 'import',
      canImport: true,
      canReconnect: true,
      canDisconnect: true,
      externalUsername,
      statusLabel: 'Connected',
      statusMessage: externalUsername
        ? `Connected as ${externalUsername}.`
        : `${providerLabel(provider)} is ready to import.`,
      lastImportCompletedAt,
    };
  }

  return {
    provider,
    providerAccountId: providerAccount.id,
    connectionState: 'reauthorization_required',
    accountStatus: providerAccount.status,
    primaryAction: 'reconnect',
    canImport: false,
    canReconnect: true,
    canDisconnect: true,
    externalUsername,
    statusLabel: 'Reconnect required',
    statusMessage: `Log in to ${providerLabel(provider)} again to continue importing.`,
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

function asTimestamp(value: unknown): number | null {
  const iso = asIsoString(value);
  if (!iso) {
    return null;
  }

  const timestamp = Date.parse(iso);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function hasDisconnectedMarker(providerAccount: ProviderAccountRecord): boolean {
  return asIsoString(providerAccount.credentialsJson.disconnectedAt) !== null;
}

function hasUsableAccessToken(providerAccount: ProviderAccountRecord, nowMs: number): boolean {
  const accessToken = asString(providerAccount.credentialsJson.accessToken);
  if (!accessToken) {
    return false;
  }

  const expiresAt = asTimestamp(providerAccount.credentialsJson.accessTokenExpiresAt);
  return expiresAt === null || expiresAt > nowMs;
}

function providerLabel(provider: ProviderImportProvider): string {
  return provider === 'trakt' ? 'Trakt' : 'Simkl';
}
