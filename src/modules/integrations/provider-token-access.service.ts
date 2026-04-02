import { withTransaction, type DbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { normalizeIsoString } from '../../lib/time.js';
import { ProfileRepository } from '../profiles/profile.repo.js';
import {
  ProviderAccountsRepository,
  type ProviderAccountRecord,
} from './provider-accounts.repo.js';
import { ProviderTokenRefreshService } from './provider-token-refresh.service.js';
import type { ProviderImportProvider } from './provider-import.types.js';

const EXPIRING_WINDOW_MS = 10 * 60 * 1000;

export type ProviderConnectionAccessView = {
  providerAccountId: string;
  profileId: string;
  provider: ProviderImportProvider;
  status: 'connected';
  providerUserId: string | null;
  externalUsername: string | null;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  accessTokenExpiresAt: string | null;
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
  lastRefreshAt: string | null;
  lastRefreshError: string | null;
  recommendedRefreshDelayMs: number | null;
};

export type ProviderTokenStatusView = {
  providerAccountId: string;
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
  providerAccountId: string;
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
    private readonly providerAccountsRepository = new ProviderAccountsRepository(),
    private readonly tokenRefreshService = new ProviderTokenRefreshService(),
    private readonly runInTransaction: TransactionRunner = withTransaction,
  ) {}

  async getConnectionForAccountProfile(
    accountId: string,
    profileId: string,
    provider: ProviderImportProvider,
  ): Promise<ProviderConnectionAccessView> {
    const providerAccount = await this.requireConnectedProviderAccountForAccountProfile(accountId, profileId, provider);
    return this.toConnectionView(providerAccount);
  }

  async getTokenStatusForAccountProfile(
    accountId: string,
    profileId: string,
    provider: ProviderImportProvider,
  ): Promise<ProviderTokenStatusView> {
    const providerAccount = await this.requireConnectedProviderAccountForAccountProfile(accountId, profileId, provider);
    return this.toTokenStatusView(providerAccount);
  }

  async getAccessTokenForAccountProfile(
    accountId: string,
    profileId: string,
    provider: ProviderImportProvider,
    options?: { forceRefresh?: boolean },
  ): Promise<ProviderAccessTokenView> {
    const providerAccount = await this.requireConnectedProviderAccountForAccountProfile(accountId, profileId, provider);

    let refreshed = false;
    let activeProviderAccount = providerAccount;
    try {
      const result = await this.tokenRefreshService.refreshProviderAccount(providerAccount, { force: options?.forceRefresh === true });
      activeProviderAccount = result.providerAccount;
      refreshed = result.refreshed;
    } catch (error) {
      throw mapRefreshError(provider, error);
    }

    const accessToken = asString(activeProviderAccount.credentialsJson.accessToken);
    const tokenState = this.toTokenStatusView(activeProviderAccount).tokenState;
    if (!accessToken || tokenState === 'expired' || tokenState === 'missing_access_token') {
      throw new HttpError(409, 'Provider connection does not have a usable access token.', { provider });
    }

    return {
      providerAccountId: activeProviderAccount.id,
      profileId: activeProviderAccount.profileId,
      provider: activeProviderAccount.provider,
      accessToken,
      accessTokenExpiresAt: asIsoString(activeProviderAccount.credentialsJson.accessTokenExpiresAt),
      refreshed,
    };
  }

  private async requireConnectedProviderAccountForAccountProfile(
    accountId: string,
    profileId: string,
    provider: ProviderImportProvider,
  ): Promise<ProviderAccountRecord> {
    return this.runInTransaction(async (client) => {
      const profile = await this.profileRepository.findByIdForOwnerUser(client, profileId, accountId);
      if (!profile) {
        throw new HttpError(404, 'Profile not found for account.');
      }

      const providerAccount = await this.providerAccountsRepository.findLatestConnectedForProfile(client, profile.id, provider);
      if (!providerAccount) {
        throw new HttpError(404, 'Provider connection not found.');
      }

      return providerAccount;
    });
  }

  private toConnectionView(providerAccount: ProviderAccountRecord): ProviderConnectionAccessView {
    return {
      providerAccountId: providerAccount.id,
      profileId: providerAccount.profileId,
      provider: providerAccount.provider,
      status: 'connected',
      providerUserId: providerAccount.providerUserId,
      externalUsername: providerAccount.externalUsername,
      createdAt: providerAccount.createdAt,
      updatedAt: providerAccount.updatedAt,
      lastUsedAt: providerAccount.lastUsedAt,
      accessTokenExpiresAt: asIsoString(providerAccount.credentialsJson.accessTokenExpiresAt),
      hasAccessToken: asString(providerAccount.credentialsJson.accessToken) !== null,
      hasRefreshToken: asString(providerAccount.credentialsJson.refreshToken) !== null,
      lastRefreshAt: asIsoString(providerAccount.credentialsJson.lastRefreshAt),
      lastRefreshError: asString(providerAccount.credentialsJson.lastRefreshError),
      recommendedRefreshDelayMs: this.tokenRefreshService.getRecommendedDelayMs(providerAccount),
    };
  }

  private toTokenStatusView(providerAccount: ProviderAccountRecord): ProviderTokenStatusView {
    const accessToken = asString(providerAccount.credentialsJson.accessToken);
    const accessTokenExpiresAt = asIsoString(providerAccount.credentialsJson.accessTokenExpiresAt);
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
      providerAccountId: providerAccount.id,
      profileId: providerAccount.profileId,
      provider: providerAccount.provider,
      tokenState,
      accessTokenExpiresAt,
      hasAccessToken: accessToken !== null,
      canRefresh: asString(providerAccount.credentialsJson.refreshToken) !== null,
      lastRefreshAt: asIsoString(providerAccount.credentialsJson.lastRefreshAt),
      lastRefreshError: asString(providerAccount.credentialsJson.lastRefreshError),
      recommendedRefreshDelayMs: this.tokenRefreshService.getRecommendedDelayMs(providerAccount),
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
