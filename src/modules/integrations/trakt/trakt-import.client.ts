import { env } from '../../../config/env.js';
import { HttpError } from '../../../lib/errors.js';
import {
  asString,
  expiresAtIsoFromNow,
  isRecord,
  parseProviderJson,
  parseProviderPayload,
  resolveProviderError,
} from '../provider-import.utils.js';
import type {
  ProviderProfileResult,
  ProviderTokenExchangeResult,
} from '../provider-import.internals.js';

function buildTraktHeaders(params: {
  accessToken?: string;
  includeAuthorization?: boolean;
}): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'trakt-api-key': env.traktImportClientId,
    'trakt-api-version': '2',
    'User-Agent': 'CrispyServer/1.0',
  };

  if (params.includeAuthorization !== false && params.accessToken) {
    headers.Authorization = `Bearer ${params.accessToken}`;
  }

  return headers;
}

export class TraktImportClient {
  private readonly baseUrl = 'https://api.trakt.tv';

  isConfigured(): boolean {
    return Boolean(env.traktImportClientId && env.traktImportClientSecret && env.traktImportRedirectUri);
  }

  buildAuthUrl(stateToken: string, codeChallenge: string): string | null {
    if (!env.traktImportClientId || !env.traktImportRedirectUri) {
      return null;
    }
    const url = new URL('https://trakt.tv/oauth/authorize');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', env.traktImportClientId);
    url.searchParams.set('redirect_uri', env.traktImportRedirectUri);
    url.searchParams.set('state', stateToken);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  async exchangeAuthorizationCode(code: string, codeVerifier: string): Promise<ProviderTokenExchangeResult> {
    if (!env.traktImportClientId || !env.traktImportClientSecret || !env.traktImportRedirectUri) {
      throw new HttpError(503, 'Trakt import is not configured.');
    }

    const response = await fetch('https://api.trakt.tv/oauth/token', {
      method: 'POST',
      headers: buildTraktHeaders({ includeAuthorization: false }),
      body: JSON.stringify({
        code,
        client_id: env.traktImportClientId,
        client_secret: env.traktImportClientSecret,
        code_verifier: codeVerifier,
        redirect_uri: env.traktImportRedirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const rawBody = await response.text();
    const payload = parseProviderJson(rawBody);
    if (!response.ok || !payload || typeof payload.access_token !== 'string') {
      throw new HttpError(
        response.status || 502,
        resolveProviderError(payload, 'Unable to exchange the Trakt authorization code.'),
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

  async fetchProfile(accessToken: string): Promise<ProviderProfileResult> {
    const response = await fetch('https://api.trakt.tv/users/settings', {
      method: 'GET',
      headers: buildTraktHeaders({ accessToken }),
    });

    if (!response.ok) {
      return {
        providerUserId: null,
        externalUsername: null,
      };
    }

    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const user = isRecord(payload?.user) ? payload!.user : null;
    const ids = isRecord(user?.ids) ? user!.ids : null;

    return {
      providerUserId: typeof ids?.slug === 'string' ? ids.slug : null,
      externalUsername: typeof user?.username === 'string' ? user!.username : null,
    };
  }

  async revokeAuthorization(credentialsJson: Record<string, unknown>): Promise<void> {
    if (!env.traktImportClientId || !env.traktImportClientSecret) {
      throw new HttpError(503, 'Trakt import is not configured.');
    }

    const token = asString(credentialsJson.refreshToken) ?? asString(credentialsJson.accessToken);
    if (!token) {
      return;
    }

    const response = await fetch('https://api.trakt.tv/oauth/revoke', {
      method: 'POST',
      headers: buildTraktHeaders({ includeAuthorization: false }),
      body: JSON.stringify({
        token,
        client_id: env.traktImportClientId,
        client_secret: env.traktImportClientSecret,
      }),
    });

    if (response.ok || response.status === 404) {
      return;
    }

    const rawBody = await response.text();
    const payload = parseProviderJson(rawBody);
    throw new HttpError(
      response.status || 502,
      resolveProviderError(payload, 'Unable to revoke the Trakt authorization.'),
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

  async getArray(
    path: string,
    accessToken: string,
    query?: Record<string, string>,
  ): Promise<Array<Record<string, unknown>>> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, value);
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: buildTraktHeaders({ accessToken }),
    });

    const rawBody = await response.text();
    const payload = parseProviderPayload(rawBody);
    if (!response.ok || !Array.isArray(payload)) {
      throw new HttpError(
        response.status || 502,
        resolveProviderError(isRecord(payload) ? payload : null, `Trakt import request failed for ${path}.`),
        rawBody.trim()
          ? {
              provider: 'trakt',
              providerStatus: response.status,
              requestPath: path,
              responseBody: rawBody.slice(0, 500),
            }
          : {
              provider: 'trakt',
              providerStatus: response.status,
              requestPath: path,
            },
      );
    }

    return payload.filter(isRecord);
  }

  async getArrayPaginated(
    path: string,
    accessToken: string,
    query?: Record<string, string | number>,
    options?: { maxPages?: number; pageSize?: number },
  ): Promise<Array<Record<string, unknown>>> {
    const maxPages = options?.maxPages ?? 200
    const pageSize = options?.pageSize ?? 100
    const allResults: Record<string, unknown>[] = []

    for (let page = 1; page <= maxPages; page++) {
      const results = await this.getArray(path, accessToken, {
        ...query,
        page: String(page),
        limit: String(pageSize),
      })

      if (!Array.isArray(results) || results.length === 0) break

      allResults.push(...results)

      if (results.length < pageSize) break
    }

    return allResults
  }
}
