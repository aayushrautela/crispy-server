import { env } from '../../../config/env.js';
import { HttpError } from '../../../lib/errors.js';
import {
  asString,
  expiresAtIsoFromNow,
  extractProviderArray,
  isRecord,
  resolveProviderError,
} from '../provider-import.utils.js';
import type {
  ProviderProfileResult,
  ProviderTokenExchangeResult,
} from '../provider-import.internals.js';

export class SimklImportClient {
  private readonly baseUrl = 'https://api.simkl.com';

  isConfigured(): boolean {
    return Boolean(env.simklImportClientId && env.simklImportClientSecret && env.simklImportRedirectUri);
  }

  buildAuthUrl(stateToken: string, codeChallenge: string): string | null {
    if (!env.simklImportClientId || !env.simklImportRedirectUri) {
      return null;
    }
    const url = new URL('https://simkl.com/oauth/authorize');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', env.simklImportClientId);
    url.searchParams.set('redirect_uri', env.simklImportRedirectUri);
    url.searchParams.set('state', stateToken);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  async exchangeAuthorizationCode(code: string, codeVerifier: string): Promise<ProviderTokenExchangeResult> {
    if (!env.simklImportClientId || !env.simklImportClientSecret || !env.simklImportRedirectUri) {
      throw new HttpError(503, 'Simkl import is not configured.');
    }

    const response = await fetch('https://simkl.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        client_id: env.simklImportClientId,
        client_secret: env.simklImportClientSecret,
        code_verifier: codeVerifier,
        redirect_uri: env.simklImportRedirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok || !payload || typeof payload.access_token !== 'string') {
      throw new HttpError(
        response.status || 502,
        resolveProviderError(payload, 'Unable to exchange the Simkl authorization code.'),
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
    const response = await fetch('https://api.simkl.com/users/settings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'simkl-api-key': env.simklImportClientId,
      },
    });

    if (!response.ok) {
      return { providerUserId: null, externalUsername: null };
    }

    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const user = payload && isRecord(payload.user) ? payload.user : null;
    const ids = user && isRecord(user.ids) ? user.ids : null;
    return {
      providerUserId: asString(ids?.id),
      externalUsername: asString(user?.name) ?? asString(user?.email),
    };
  }

  async revokeAuthorization(_credentialsJson: Record<string, unknown>): Promise<void> {
    return;
  }

  async getArray(
    path: string,
    accessToken: string,
    query?: Record<string, string>,
    collectionKey?: string,
  ): Promise<Array<Record<string, unknown>>> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, value);
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'simkl-api-key': env.simklImportClientId,
      },
    });

    const payload = (await response.json().catch(() => null)) as unknown;
    const records = extractProviderArray(payload, collectionKey);
    if (!response.ok || records === null) {
      throw new HttpError(response.status || 502, `Simkl import request failed for ${path}.`);
    }
    return records;
  }
}
