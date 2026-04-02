import { withTransaction, type DbClient } from '../../lib/db.js';
import { env } from '../../config/env.js';
import { HttpError } from '../../lib/errors.js';
import {
  ProviderAccountsRepository,
  type ProviderAccountRecord,
} from './provider-accounts.repo.js';

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
    private readonly providerAccountsRepository = new ProviderAccountsRepository(),
    private readonly runInTransaction: TransactionRunner = withTransaction,
  ) {}

  async refreshProviderAccountById(
    providerAccountId: string,
    options?: { force?: boolean },
  ): Promise<{ providerAccount: ProviderAccountRecord; refreshed: boolean } | null> {
    const providerAccount = await this.runInTransaction(async (client) => {
      return this.providerAccountsRepository.findById(client, providerAccountId);
    });
    if (!providerAccount || providerAccount.status !== 'connected') {
      return null;
    }

    return this.refreshProviderAccount(providerAccount, options);
  }

  async refreshProviderAccount(
    providerAccount: ProviderAccountRecord,
    options?: { force?: boolean },
  ): Promise<{ providerAccount: ProviderAccountRecord; refreshed: boolean }> {
    const refreshToken = asString(providerAccount.credentialsJson.refreshToken);
    if (!refreshToken) {
      return { providerAccount, refreshed: false };
    }

    const expiresAt = asTimestamp(providerAccount.credentialsJson.accessTokenExpiresAt);
    const shouldRefresh = options?.force === true || expiresAt === null || expiresAt - Date.now() <= REFRESH_WINDOW_MS;
    if (!shouldRefresh) {
      return { providerAccount, refreshed: false };
    }

    try {
      const exchanged = providerAccount.provider === 'simkl'
        ? await this.exchangeSimklRefreshToken(refreshToken)
        : await this.exchangeTraktRefreshToken(refreshToken);
      const refreshedAt = new Date().toISOString();
      const updated = await this.runInTransaction(async (client) => {
        return this.providerAccountsRepository.updateConnectedCredentials(client, {
          providerAccountId: providerAccount.id,
          credentialsJson: {
            ...providerAccount.credentialsJson,
            accessToken: exchanged.accessToken,
            refreshToken: exchanged.refreshToken ?? refreshToken,
            accessTokenExpiresAt: exchanged.accessTokenExpiresAt,
            lastRefreshAt: refreshedAt,
            lastRefreshError: null,
            tokenPayload: exchanged.raw,
          },
          providerUserId: providerAccount.providerUserId,
          externalUsername: providerAccount.externalUsername,
          lastUsedAt: refreshedAt,
        });
      });

      return { providerAccount: updated, refreshed: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Provider token refresh failed.';
      await this.runInTransaction(async (client) => {
        await this.providerAccountsRepository.updateConnectedCredentials(client, {
          providerAccountId: providerAccount.id,
          credentialsJson: {
            ...providerAccount.credentialsJson,
            lastRefreshAt: new Date().toISOString(),
            lastRefreshError: errorMessage,
          },
          providerUserId: providerAccount.providerUserId,
          externalUsername: providerAccount.externalUsername,
        });
      });
      throw error;
    }
  }

  getRecommendedDelayMs(providerAccount: ProviderAccountRecord): number | null {
    const refreshToken = asString(providerAccount.credentialsJson.refreshToken);
    if (!refreshToken) {
      return null;
    }

    const expiresAt = asTimestamp(providerAccount.credentialsJson.accessTokenExpiresAt);
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
