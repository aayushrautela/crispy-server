import { withTransaction } from '../../lib/db.js';
import { env } from '../../config/env.js';
import { HttpError } from '../../lib/errors.js';
import {
  ProviderImportConnectionsRepository,
  type ProviderImportConnectionRecord,
} from './provider-import-connections.repo.js';

const REFRESH_WINDOW_MS = 10 * 60 * 1000;
const MIN_DELAY_MS = 30 * 1000;

type ProviderTokenExchangeResult = {
  accessToken: string;
  refreshToken: string | null;
  accessTokenExpiresAt: string | null;
  raw: Record<string, unknown>;
};

export class ProviderTokenRefreshService {
  constructor(
    private readonly connectionsRepository = new ProviderImportConnectionsRepository(),
  ) {}

  async refreshConnectionById(
    connectionId: string,
    options?: { force?: boolean },
  ): Promise<{ connection: ProviderImportConnectionRecord; refreshed: boolean } | null> {
    const connection = await withTransaction(async (client) => this.connectionsRepository.findById(client, connectionId));
    if (!connection || connection.status !== 'connected') {
      return null;
    }

    return this.refreshConnection(connection, options);
  }

  async refreshConnection(
    connection: ProviderImportConnectionRecord,
    options?: { force?: boolean },
  ): Promise<{ connection: ProviderImportConnectionRecord; refreshed: boolean }> {
    const refreshToken = asString(connection.credentialsJson.refreshToken);
    if (!refreshToken) {
      return { connection, refreshed: false };
    }

    const expiresAt = asTimestamp(connection.credentialsJson.accessTokenExpiresAt);
    const shouldRefresh = options?.force === true || expiresAt === null || expiresAt - Date.now() <= REFRESH_WINDOW_MS;
    if (!shouldRefresh) {
      return { connection, refreshed: false };
    }

    try {
      const exchanged = connection.provider === 'simkl'
        ? await this.exchangeSimklRefreshToken(refreshToken)
        : await this.exchangeTraktRefreshToken(refreshToken);
      const refreshedAt = new Date().toISOString();
      const updated = await withTransaction(async (client) => {
        return this.connectionsRepository.updateConnectedCredentials(client, {
          connectionId: connection.id,
          credentialsJson: {
            ...connection.credentialsJson,
            accessToken: exchanged.accessToken,
            refreshToken: exchanged.refreshToken ?? refreshToken,
            accessTokenExpiresAt: exchanged.accessTokenExpiresAt,
            lastRefreshAt: refreshedAt,
            lastRefreshError: null,
            tokenPayload: exchanged.raw,
          },
          providerUserId: connection.providerUserId,
          externalUsername: connection.externalUsername,
          lastUsedAt: refreshedAt,
        });
      });

      return { connection: updated, refreshed: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Provider token refresh failed.';
      await withTransaction(async (client) => {
        await this.connectionsRepository.updateConnectedCredentials(client, {
          connectionId: connection.id,
          credentialsJson: {
            ...connection.credentialsJson,
            lastRefreshAt: new Date().toISOString(),
            lastRefreshError: errorMessage,
          },
          providerUserId: connection.providerUserId,
          externalUsername: connection.externalUsername,
        });
      });
      throw error;
    }
  }

  getRecommendedDelayMs(connection: ProviderImportConnectionRecord): number | null {
    const refreshToken = asString(connection.credentialsJson.refreshToken);
    if (!refreshToken) {
      return null;
    }

    const expiresAt = asTimestamp(connection.credentialsJson.accessTokenExpiresAt);
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
