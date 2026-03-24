import { withTransaction, type DbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { ProfileRepository } from '../profiles/profile.repo.js';
import {
  ProviderImportConnectionsRepository,
  type ProviderImportConnectionRecord,
} from './provider-import-connections.repo.js';
import { ProviderTokenRefreshService } from './provider-token-refresh.service.js';
import type { ProviderImportProvider } from './provider-import.types.js';

const EXPIRING_WINDOW_MS = 10 * 60 * 1000;

export type ProviderConnectionAccessView = {
  connectionId: string;
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
  connectionId: string;
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
  connectionId: string;
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
    private readonly connectionsRepository = new ProviderImportConnectionsRepository(),
    private readonly tokenRefreshService = new ProviderTokenRefreshService(),
    private readonly runInTransaction: TransactionRunner = withTransaction,
  ) {}

  async getConnection(profileId: string, provider: ProviderImportProvider): Promise<ProviderConnectionAccessView> {
    const connection = await this.requireConnectedConnection(profileId, provider);
    return this.toConnectionView(connection);
  }

  async getTokenStatus(profileId: string, provider: ProviderImportProvider): Promise<ProviderTokenStatusView> {
    const connection = await this.requireConnectedConnection(profileId, provider);
    return this.toTokenStatusView(connection);
  }

  async getAccessToken(
    profileId: string,
    provider: ProviderImportProvider,
    options?: { forceRefresh?: boolean },
  ): Promise<ProviderAccessTokenView> {
    const connection = await this.requireConnectedConnection(profileId, provider);

    let refreshed = false;
    let activeConnection = connection;
    try {
      const result = await this.tokenRefreshService.refreshConnection(connection, { force: options?.forceRefresh === true });
      activeConnection = result.connection;
      refreshed = result.refreshed;
    } catch (error) {
      throw mapRefreshError(provider, error);
    }

    const accessToken = asString(activeConnection.credentialsJson.accessToken);
    const tokenState = this.toTokenStatusView(activeConnection).tokenState;
    if (!accessToken || tokenState === 'expired' || tokenState === 'missing_access_token') {
      throw new HttpError(409, 'Provider connection does not have a usable access token.', { provider });
    }

    return {
      connectionId: activeConnection.id,
      profileId: activeConnection.profileId,
      provider: activeConnection.provider,
      accessToken,
      accessTokenExpiresAt: asIsoString(activeConnection.credentialsJson.accessTokenExpiresAt),
      refreshed,
    };
  }

  private async requireConnectedConnection(profileId: string, provider: ProviderImportProvider): Promise<ProviderImportConnectionRecord> {
    return this.runInTransaction(async (client) => {
      const profile = await this.profileRepository.findById(client, profileId);
      if (!profile) {
        throw new HttpError(404, 'Profile not found.');
      }

      const connection = await this.connectionsRepository.findLatestConnectedForProfile(client, profileId, provider);
      if (!connection) {
        throw new HttpError(404, 'Provider connection not found.');
      }

      return connection;
    });
  }

  private toConnectionView(connection: ProviderImportConnectionRecord): ProviderConnectionAccessView {
    return {
      connectionId: connection.id,
      profileId: connection.profileId,
      provider: connection.provider,
      status: 'connected',
      providerUserId: connection.providerUserId,
      externalUsername: connection.externalUsername,
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt,
      lastUsedAt: connection.lastUsedAt,
      accessTokenExpiresAt: asIsoString(connection.credentialsJson.accessTokenExpiresAt),
      hasAccessToken: asString(connection.credentialsJson.accessToken) !== null,
      hasRefreshToken: asString(connection.credentialsJson.refreshToken) !== null,
      lastRefreshAt: asIsoString(connection.credentialsJson.lastRefreshAt),
      lastRefreshError: asString(connection.credentialsJson.lastRefreshError),
      recommendedRefreshDelayMs: this.tokenRefreshService.getRecommendedDelayMs(connection),
    };
  }

  private toTokenStatusView(connection: ProviderImportConnectionRecord): ProviderTokenStatusView {
    const accessToken = asString(connection.credentialsJson.accessToken);
    const accessTokenExpiresAt = asIsoString(connection.credentialsJson.accessTokenExpiresAt);
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
      connectionId: connection.id,
      profileId: connection.profileId,
      provider: connection.provider,
      tokenState,
      accessTokenExpiresAt,
      hasAccessToken: accessToken !== null,
      canRefresh: asString(connection.credentialsJson.refreshToken) !== null,
      lastRefreshAt: asIsoString(connection.credentialsJson.lastRefreshAt),
      lastRefreshError: asString(connection.credentialsJson.lastRefreshError),
      recommendedRefreshDelayMs: this.tokenRefreshService.getRecommendedDelayMs(connection),
    };
  }
}

function mapRefreshError(provider: ProviderImportProvider, error: unknown): HttpError {
  if (error instanceof HttpError && error.statusCode === 503) {
    return new HttpError(503, 'Provider token refresh is not configured.', { provider });
  }

  if (error instanceof HttpError) {
    return new HttpError(502, 'Provider access token refresh failed.', {
      provider,
      upstreamStatusCode: error.statusCode,
    });
  }

  return new HttpError(502, 'Provider access token refresh failed.', { provider });
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
