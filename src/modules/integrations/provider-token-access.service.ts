import { withTransaction, type DbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { normalizeIsoString } from '../../lib/time.js';
import { ProfileRepository } from '../profiles/profile.repo.js';
import {
  ProviderSessionsRepository,
  type ProviderSessionConnectedRecord,
  type ProviderSessionRecord,
} from './provider-sessions.repo.js';
import { ProviderTokenRefreshService } from './provider-token-refresh.service.js';
import type { ProviderImportProvider } from './provider-import.types.js';

const EXPIRING_WINDOW_MS = 10 * 60 * 1000;

export type ProviderConnectionAccessView = {
  profileId: string;
  provider: ProviderImportProvider;
  status: 'connected';
  providerUserId: string | null;
  externalUsername: string | null;
  createdAt: string;
  updatedAt: string;
  accessTokenExpiresAt: string | null;
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
  lastRefreshAt: string | null;
  lastRefreshError: string | null;
  recommendedRefreshDelayMs: number | null;
};

export type ProviderTokenStatusView = {
  profileId: string;
  provider: ProviderImportProvider;
  tokenState: 'valid' | 'expiring' | 'expired' | 'missing_access_token';
  accessTokenExpiresAt: string | null;
  hasAccessToken: boolean;
  canRefresh: boolean;
  lastRefreshAt: string | null;
  lastRefreshError: string | null;
  recommendedRefreshDelayMs: number | null;
};

export type ProviderAccessTokenView = {
  profileId: string;
  provider: ProviderImportProvider;
  accessToken: string;
  accessTokenExpiresAt: string | null;
  refreshed: boolean;
};

type TransactionRunner = <T>(work: (client: DbClient) => Promise<T>) => Promise<T>;

export class ProviderTokenAccessService {
  constructor(
    private readonly profileRepository = new ProfileRepository(),
    private readonly providerSessionsRepository = new ProviderSessionsRepository(),
    private readonly tokenRefreshService = new ProviderTokenRefreshService(),
    private readonly runInTransaction: TransactionRunner = withTransaction,
  ) {}

  async getConnectionForAccountProfile(
    accountId: string,
    profileId: string,
    provider: ProviderImportProvider,
  ): Promise<ProviderConnectionAccessView> {
    const providerSession = await this.requireConnectedProviderSessionForAccountProfile(accountId, profileId, provider);
    return this.toConnectionView(providerSession);
  }

  async getTokenStatusForAccountProfile(
    accountId: string,
    profileId: string,
    provider: ProviderImportProvider,
  ): Promise<ProviderTokenStatusView> {
    const providerSession = await this.requireConnectedProviderSessionForAccountProfile(accountId, profileId, provider);
    return this.toTokenStatusView(providerSession);
  }

  async getAccessTokenForAccountProfile(
    accountId: string,
    profileId: string,
    provider: ProviderImportProvider,
    options?: { forceRefresh?: boolean },
  ): Promise<ProviderAccessTokenView> {
    const providerSession = await this.requireConnectedProviderSessionForAccountProfile(accountId, profileId, provider);

    let refreshed = false;
    let activeProviderSession = providerSession;
    try {
      const result = await this.tokenRefreshService.refreshConnectedSession(providerSession, { force: options?.forceRefresh === true });
      activeProviderSession = result.providerSession;
      refreshed = result.refreshed;
    } catch (error) {
      throw mapRefreshError(provider, error);
    }

    const accessToken = asString(activeProviderSession.credentialsJson.accessToken);
    const tokenState = this.toTokenStatusView(activeProviderSession).tokenState;
    if (!accessToken || tokenState === 'expired' || tokenState === 'missing_access_token') {
      throw new HttpError(409, 'Provider connection does not have a usable access token.', { provider });
    }

    return {
      profileId: activeProviderSession.profileId,
      provider: activeProviderSession.provider,
      accessToken,
      accessTokenExpiresAt: asIsoString(activeProviderSession.credentialsJson.accessTokenExpiresAt),
      refreshed,
    };
  }

  private async requireConnectedProviderSessionForAccountProfile(
    accountId: string,
    profileId: string,
    provider: ProviderImportProvider,
  ): Promise<ProviderSessionConnectedRecord> {
    return this.runInTransaction(async (client) => {
      const profile = await this.profileRepository.findByIdForOwnerUser(client, profileId, accountId);
      if (!profile) {
        throw new HttpError(404, 'Profile not found for account.');
      }

      const providerSession = await this.providerSessionsRepository.getConnectedSession(client, profile.id, provider);
      if (!providerSession) {
        throw new HttpError(404, 'Provider connection not found.');
      }

      return providerSession;
    });
  }

  private toConnectionView(providerSession: ProviderSessionConnectedRecord): ProviderConnectionAccessView {
    return {
      profileId: providerSession.profileId,
      provider: providerSession.provider,
      status: 'connected',
      providerUserId: providerSession.providerUserId,
      externalUsername: providerSession.externalUsername,
      createdAt: providerSession.createdAt,
      updatedAt: providerSession.updatedAt,
      accessTokenExpiresAt: asIsoString(providerSession.credentialsJson.accessTokenExpiresAt),
      hasAccessToken: asString(providerSession.credentialsJson.accessToken) !== null,
      hasRefreshToken: asString(providerSession.credentialsJson.refreshToken) !== null,
      lastRefreshAt: providerSession.lastRefreshAt,
      lastRefreshError: providerSession.lastRefreshError,
      recommendedRefreshDelayMs: this.tokenRefreshService.getRecommendedDelayMs(providerSession),
    };
  }

  private toTokenStatusView(providerSession: ProviderSessionRecord): ProviderTokenStatusView {
    const accessToken = asString(providerSession.credentialsJson.accessToken);
    const accessTokenExpiresAt = asIsoString(providerSession.credentialsJson.accessTokenExpiresAt);
    const expiresAtTimestamp = accessTokenExpiresAt ? Date.parse(accessTokenExpiresAt) : null;
    const now = Date.now();

    let tokenState: ProviderTokenStatusView['tokenState'] = 'valid';
    if (!accessToken) {
      tokenState = 'missing_access_token';
    } else if (expiresAtTimestamp !== null && expiresAtTimestamp <= now) {
      tokenState = 'expired';
    } else if (expiresAtTimestamp !== null && expiresAtTimestamp - now <= EXPIRING_WINDOW_MS) {
      tokenState = 'expiring';
    }

    return {
      profileId: providerSession.profileId,
      provider: providerSession.provider,
      tokenState,
      accessTokenExpiresAt,
      hasAccessToken: accessToken !== null,
      canRefresh: asString(providerSession.credentialsJson.refreshToken) !== null,
      lastRefreshAt: providerSession.lastRefreshAt,
      lastRefreshError: providerSession.lastRefreshError,
      recommendedRefreshDelayMs: this.tokenRefreshService.getRecommendedDelayMs(providerSession),
    };
  }
}

function mapRefreshError(provider: ProviderImportProvider, error: unknown): HttpError {
  if (error instanceof HttpError && error.statusCode === 503) {
    return new HttpError(503, 'Provider token refresh is not configured.', { provider });
  }

  if (error instanceof HttpError) {
    return new HttpError(502, error.message || 'Provider access token refresh failed.', mergeRefreshErrorDetails(provider, error));
  }

  return new HttpError(502, 'Provider access token refresh failed.', { provider });
}

function mergeRefreshErrorDetails(
  provider: ProviderImportProvider,
  error: HttpError,
): Record<string, unknown> {
  const details: Record<string, unknown> = {
    provider,
    upstreamStatusCode: error.statusCode,
  };

  if (isRecord(error.details)) {
    return {
      ...details,
      ...error.details,
    };
  }

  if (error.details !== undefined) {
    details.upstreamDetails = error.details;
  }

  return details;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
