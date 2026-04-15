import { normalizeIsoString } from '../../lib/time.js';
import type { ProviderImportJobAdminRecord, ProviderImportJobRecord } from './provider-import-jobs.repo.js';
import type { ProviderSessionRecord } from './provider-sessions.repo.js';
import type { ProviderImportProvider } from './provider-import.types.js';

export type ProviderStateConnectionState =
  | 'not_connected'
  | 'pending_authorization'
  | 'connected'
  | 'reauthorization_required';

export type ProviderStatePrimaryAction = 'connect' | 'import' | 'reconnect';

export type ProviderStateView = {
  provider: ProviderImportProvider;
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

export function mapProviderSessionStateView(
  provider: ProviderImportProvider,
  providerSession: ProviderSessionRecord | null,
  nowMs = Date.now(),
): ProviderStateView {
  if (!providerSession || providerSession.state === 'not_connected' || providerSession.state === 'disconnected_by_user') {
    return {
      provider,
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

  const lastImportCompletedAt = firstIsoString(
    providerSession.lastImportCompletedAt,
    providerSession.credentialsJson.lastImportCompletedAt,
  );
  const externalUsername = providerSession.externalUsername;

  if (providerSession.state === 'oauth_pending') {
    return {
      provider,
      connectionState: 'pending_authorization',
      accountStatus: 'pending',
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

  if (providerSession.state === 'connected' && hasUsableSessionAccessToken(providerSession, nowMs)) {
    return {
      provider,
      connectionState: 'connected',
      accountStatus: 'connected',
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
    connectionState: 'reauthorization_required',
    accountStatus: providerSession.state === 'reauth_required' ? 'revoked' : 'connected',
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

function firstIsoString(...values: unknown[]): string | null {
  for (const value of values) {
    const normalized = asIsoString(value);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function asTimestamp(value: unknown): number | null {
  const iso = asIsoString(value);
  if (!iso) {
    return null;
  }

  const timestamp = Date.parse(iso);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function hasUsableSessionAccessToken(providerSession: ProviderSessionRecord, nowMs: number): boolean {
  const accessToken = asString(providerSession.credentialsJson.accessToken);
  if (!accessToken) {
    return false;
  }

  const expiresAt = asTimestamp(providerSession.credentialsJson.accessTokenExpiresAt);
  return expiresAt === null || expiresAt > nowMs;
}

function providerLabel(provider: ProviderImportProvider): string {
  return provider === 'trakt' ? 'Trakt' : 'Simkl';
}
