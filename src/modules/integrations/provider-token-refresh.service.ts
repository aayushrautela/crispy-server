import { withTransaction, type DbClient } from '../../lib/db.js';
import { env } from '../../config/env.js';
import { HttpError } from '../../lib/errors.js';
import {
  ProviderSessionsRepository,
  type ProviderSessionConnectedRecord,
  type ProviderSessionRecord,
} from './provider-sessions.repo.js';
import type { ProviderImportProvider } from './provider-import.types.js';

const REFRESH_WINDOW_MS = 10 * 60 * 1000;
const MIN_DELAY_MS = 30 * 1000;

type ProviderTokenExchangeResult = {
  accessToken: string;
  refreshToken: string | null;
  accessTokenExpiresAt: string | null;
  raw: Record<string, unknown>;
};

type TransactionRunner = <T>(work: (client: DbClient) => Promise<T>) => Promise<T>;

export class ProviderTokenRefreshService {
  constructor(
    private readonly providerSessionsRepository = new ProviderSessionsRepository(),
    private readonly runInTransaction: TransactionRunner = withTransaction,
  ) {}

  async refreshProviderSession(
    profileId: string,
    provider: ProviderImportProvider,
    options?: { force?: boolean },
  ): Promise<{ providerSession: ProviderSessionConnectedRecord; refreshed: boolean } | null> {
    const providerSession = await this.runInTransaction(async (client) => {
      return this.providerSessionsRepository.getConnectedSession(client, profileId, provider);
    });
    if (!providerSession) {
      return null;
    }

    return this.refreshConnectedSession(providerSession, options);
  }

  async refreshConnectedSession(
    providerSession: ProviderSessionConnectedRecord,
    options?: { force?: boolean },
  ): Promise<{ providerSession: ProviderSessionConnectedRecord; refreshed: boolean }> {
    const refreshToken = asString(providerSession.credentialsJson.refreshToken);
    if (!refreshToken) {
      return { providerSession, refreshed: false };
    }

    const expiresAt = asTimestamp(providerSession.credentialsJson.accessTokenExpiresAt);
    const shouldRefresh = options?.force === true || expiresAt === null || expiresAt - Date.now() <= REFRESH_WINDOW_MS;
    if (!shouldRefresh) {
      return { providerSession, refreshed: false };
    }

    try {
      const exchanged = providerSession.provider === 'simkl'
        ? await this.exchangeSimklRefreshToken(refreshToken)
        : await this.exchangeTraktRefreshToken(refreshToken);
      const refreshedAt = new Date().toISOString();
      const updated = await this.runInTransaction(async (client) => {
        return this.providerSessionsRepository.updateConnectedTokens(client, {
          profileId: providerSession.profileId,
          provider: providerSession.provider,
          credentialsJson: {
            ...providerSession.credentialsJson,
            accessToken: exchanged.accessToken,
            refreshToken: exchanged.refreshToken ?? refreshToken,
            accessTokenExpiresAt: exchanged.accessTokenExpiresAt,
            lastRefreshAt: refreshedAt,
            lastRefreshError: null,
            tokenPayload: exchanged.raw,
          },
          providerUserId: providerSession.providerUserId,
          externalUsername: providerSession.externalUsername,
          lastRefreshAt: refreshedAt,
          lastImportCompletedAt: providerSession.lastImportCompletedAt,
        });
      });

      return { providerSession: updated, refreshed: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Provider token refresh failed.';
      const failedAt = new Date().toISOString();
      await this.runInTransaction(async (client) => {
        if (shouldRevokeConnection(error)) {
          await this.providerSessionsRepository.markReauthRequired(client, {
            profileId: providerSession.profileId,
            provider: providerSession.provider,
            providerUserId: providerSession.providerUserId,
            externalUsername: providerSession.externalUsername,
            credentialsJson: sanitizeRevokedCredentials(providerSession.credentialsJson, failedAt, errorMessage),
            lastRefreshAt: failedAt,
            lastRefreshError: errorMessage,
            lastImportCompletedAt: providerSession.lastImportCompletedAt,
          });
          return;
        }

        await this.providerSessionsRepository.updateConnectedTokens(client, {
          profileId: providerSession.profileId,
          provider: providerSession.provider,
          credentialsJson: {
            ...providerSession.credentialsJson,
            lastRefreshAt: failedAt,
            lastRefreshError: errorMessage,
          },
          providerUserId: providerSession.providerUserId,
          externalUsername: providerSession.externalUsername,
          lastRefreshAt: failedAt,
          lastImportCompletedAt: providerSession.lastImportCompletedAt,
        });
      });
      throw error;
    }
  }

  getRecommendedDelayMs(providerSession: ProviderSessionRecord): number | null {
    const refreshToken = asString(providerSession.credentialsJson.refreshToken);
    if (!refreshToken) {
      return null;
    }

    const expiresAt = asTimestamp(providerSession.credentialsJson.accessTokenExpiresAt);
    if (expiresAt === null) {
      return MIN_DELAY_MS;
    }

    return Math.max(MIN_DELAY_MS, expiresAt - Date.now() - REFRESH_WINDOW_MS);
  }

  private async exchangeTraktRefreshToken(refreshToken: string): Promise<ProviderTokenExchangeResult> {
    if (!env.traktImportClientId || !env.traktImportClientSecret || !env.traktImportRedirectUri) {
      throw new HttpError(503, 'Trakt import is not configured.');
    }

    const response = await fetch('https://api.trakt.tv/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        refresh_token: refreshToken,
        client_id: env.traktImportClientId,
        client_secret: env.traktImportClientSecret,
        redirect_uri: env.traktImportRedirectUri,
        grant_type: 'refresh_token',
      }),
    });

    const rawBody = await response.text();
    const payload = parseProviderJson(rawBody);
    if (!response.ok || !payload || typeof payload.access_token !== 'string') {
      throw new HttpError(
        response.status || 502,
        resolveProviderError(payload, 'Unable to refresh the Trakt access token.'),
        rawBody.trim()
          ? {
              provider: 'trakt',
              providerStatus: response.status,
              responseBody: rawBody.slice(0, 500),
            }
          : {
              provider: 'trakt',
              providerStatus: response.status,
            },
      );
    }

    return {
      accessToken: payload.access_token,
      refreshToken: typeof payload.refresh_token === 'string' ? payload.refresh_token : null,
      accessTokenExpiresAt: expiresAtIsoFromNow(payload.expires_in),
      raw: payload,
    };
  }

  private async exchangeSimklRefreshToken(refreshToken: string): Promise<ProviderTokenExchangeResult> {
    if (!env.simklImportClientId || !env.simklImportClientSecret || !env.simklImportRedirectUri) {
      throw new HttpError(503, 'Simkl import is not configured.');
    }

    const response = await fetch('https://api.simkl.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        refresh_token: refreshToken,
        client_id: env.simklImportClientId,
        client_secret: env.simklImportClientSecret,
        redirect_uri: env.simklImportRedirectUri,
        grant_type: 'refresh_token',
      }),
    });

    const rawBody = await response.text();
    const payload = parseProviderJson(rawBody);
    if (!response.ok || !payload || typeof payload.access_token !== 'string') {
      throw new HttpError(
        response.status || 502,
        resolveProviderError(payload, 'Unable to refresh the Simkl access token.'),
        rawBody.trim()
          ? {
              provider: 'simkl',
              providerStatus: response.status,
              responseBody: rawBody.slice(0, 500),
            }
          : {
              provider: 'simkl',
              providerStatus: response.status,
            },
      );
    }

    return {
      accessToken: payload.access_token,
      refreshToken: typeof payload.refresh_token === 'string' ? payload.refresh_token : null,
      accessTokenExpiresAt: expiresAtIsoFromNow(payload.expires_in),
      raw: payload,
    };
  }
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asTimestamp(value: unknown): number | null {
  const iso = asString(value);
  if (!iso) {
    return null;
  }

  const timestamp = Date.parse(iso);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function expiresAtIsoFromNow(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return new Date(Date.now() + value * 1000).toISOString();
}

function resolveProviderError(payload: Record<string, unknown> | null, fallback: string): string {
  if (typeof payload?.error_description === 'string' && payload.error_description.trim()) {
    return payload.error_description;
  }
  if (typeof payload?.error === 'string' && payload.error.trim()) {
    return payload.error;
  }
  return fallback;
}

function shouldRevokeConnection(error: unknown): boolean {
  if (!(error instanceof HttpError)) {
    return false;
  }

  if (![400, 401, 403].includes(error.statusCode)) {
    return false;
  }

  const message = error.message.trim().toLowerCase();
  if (!message) {
    return false;
  }

  return message.includes('invalid_grant') ||
    message.includes('invalid grant') ||
    message.includes('invalid refresh token') ||
    (message.includes('refresh token') && message.includes('expired')) ||
    message.includes('invalid token') ||
    message.includes('token is invalid') ||
    message.includes('token has expired') ||
    message.includes('authorization has expired');
}

function sanitizeRevokedCredentials(
  credentials: Record<string, unknown>,
  revokedAt: string,
  refreshError: string,
): Record<string, unknown> {
  return {
    lastImportJobId: asString(credentials.lastImportJobId),
    lastImportCompletedAt: asString(credentials.lastImportCompletedAt),
    lastRefreshAt: revokedAt,
    lastRefreshError: refreshError,
    revokedAt,
  };
}

function parseProviderJson(rawBody: string): Record<string, unknown> | null {
  if (!rawBody.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawBody) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
