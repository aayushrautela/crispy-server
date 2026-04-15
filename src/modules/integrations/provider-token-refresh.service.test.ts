import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

type ReauthParams = {
  profileId: string;
  provider: string;
  providerUserId?: string | null;
  externalUsername?: string | null;
  credentialsJson: Record<string, unknown>;
  lastRefreshAt?: string | null;
  lastRefreshError?: string | null;
  lastImportCompletedAt?: string | null;
};

type UpdateParams = {
  profileId: string;
  provider: string;
  credentialsJson: Record<string, unknown>;
  providerUserId?: string | null;
  externalUsername?: string | null;
  lastRefreshAt: string;
  lastImportCompletedAt?: string | null;
};

seedTestEnv({
  TRAKT_IMPORT_CLIENT_ID: 'trakt-id',
  TRAKT_IMPORT_CLIENT_SECRET: 'trakt-secret',
  TRAKT_IMPORT_REDIRECT_URI: 'http://localhost/trakt/callback',
  SIMKL_IMPORT_CLIENT_ID: 'simkl-id',
  SIMKL_IMPORT_CLIENT_SECRET: 'simkl-secret',
  SIMKL_IMPORT_REDIRECT_URI: 'http://localhost/simkl/callback',
});

const noopTransaction = async <T>(work: (client: never) => Promise<T>): Promise<T> => work({} as never);

const connectedSession = {
  profileId: 'profile-1',
  provider: 'trakt',
  state: 'connected',
  providerAccountId: null,
  providerUserId: 'user-1',
  externalUsername: 'crispy',
  credentialsJson: { accessToken: 'access', refreshToken: 'refresh' },
  stateToken: null,
  expiresAt: null,
  lastRefreshAt: null,
  lastRefreshError: null,
  lastImportCompletedAt: null,
  disconnectedAt: null,
  createdAt: '2026-04-14T15:20:00.000Z',
  updatedAt: '2026-04-14T15:20:00.000Z',
} as const;

test('refreshProviderSession returns null for non-existent session', async () => {
  const { ProviderTokenRefreshService } = await import('./provider-token-refresh.service.js');
  const service = new ProviderTokenRefreshService({ getConnectedSession: async () => null } as never, noopTransaction);
  const result = await service.refreshProviderSession('profile-1', 'trakt');
  assert.equal(result, null);
});

test('refreshConnectedSession skips refresh when token is not expiring', async () => {
  const { ProviderTokenRefreshService } = await import('./provider-token-refresh.service.js');
  const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const providerSession = {
    ...connectedSession,
    credentialsJson: { accessToken: 'access', refreshToken: 'refresh', accessTokenExpiresAt: futureDate },
  };
  const service = new ProviderTokenRefreshService({} as never, noopTransaction);

  const result = await service.refreshConnectedSession(providerSession as never);
  assert.equal(result.refreshed, false);
});

test('refreshConnectedSession forces refresh when force option is set', async () => {
  const { ProviderTokenRefreshService } = await import('./provider-token-refresh.service.js');
  const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const providerSession = {
    ...connectedSession,
    credentialsJson: { accessToken: 'access', refreshToken: 'refresh', accessTokenExpiresAt: futureDate },
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 })) as typeof fetch;

  let updateParams: UpdateParams | null = null;

  try {
    const service = new ProviderTokenRefreshService({
      updateConnectedTokens: async (_client: unknown, params: UpdateParams) => {
        updateParams = params;
        return { ...providerSession, credentialsJson: params.credentialsJson, lastRefreshAt: params.lastRefreshAt };
      },
    } as never, noopTransaction);

    const result = await service.refreshConnectedSession(providerSession as never, { force: true });
    assert.equal(result.refreshed, true);
    assert.ok(updateParams);
    const capturedUpdate: UpdateParams = updateParams;
    assert.equal(capturedUpdate.profileId, 'profile-1');
    assert.equal(capturedUpdate.provider, 'trakt');
    assert.equal(capturedUpdate.credentialsJson.accessToken, 'new-access');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('refreshConnectedSession returns refreshed false when no refresh token exists', async () => {
  const { ProviderTokenRefreshService } = await import('./provider-token-refresh.service.js');
  const providerSession = {
    ...connectedSession,
    credentialsJson: { accessToken: 'access' },
  };
  const service = new ProviderTokenRefreshService({} as never, noopTransaction);

  const result = await service.refreshConnectedSession(providerSession as never);
  assert.equal(result.refreshed, false);
});

test('refreshConnectedSession forces refresh for simkl when force option is set', async () => {
  const { ProviderTokenRefreshService } = await import('./provider-token-refresh.service.js');
  const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const providerSession = {
    ...connectedSession,
    provider: 'simkl',
    credentialsJson: { accessToken: 'access', refreshToken: 'refresh', accessTokenExpiresAt: futureDate },
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({ access_token: 'new-simkl-access', refresh_token: 'new-simkl-refresh', expires_in: 3600 })) as typeof fetch;

  try {
    const service = new ProviderTokenRefreshService({
      updateConnectedTokens: async (_client: unknown, params: UpdateParams) => ({
        ...providerSession,
        credentialsJson: params.credentialsJson,
        lastRefreshAt: params.lastRefreshAt,
      }),
    } as never, noopTransaction);

    const result = await service.refreshConnectedSession(providerSession as never, { force: true });
    assert.equal(result.refreshed, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('refreshConnectedSession marks trakt session reauth required when refresh token is invalid', async () => {
  const { ProviderTokenRefreshService } = await import('./provider-token-refresh.service.js');
  const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const providerSession = {
    ...connectedSession,
    credentialsJson: {
      accessToken: 'access',
      refreshToken: 'refresh',
      accessTokenExpiresAt: futureDate,
      lastImportJobId: 'job-1',
      lastImportCompletedAt: '2026-04-14T15:20:00.000Z',
    },
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: 'invalid_grant' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  })) as typeof fetch;

  let reauthParams: ReauthParams | null = null;

  try {
    const service = new ProviderTokenRefreshService({
      markReauthRequired: async (_client: unknown, params: ReauthParams) => {
        reauthParams = params;
        return { ...providerSession, state: 'reauth_required', credentialsJson: params.credentialsJson, lastRefreshAt: params.lastRefreshAt, lastRefreshError: params.lastRefreshError };
      },
      updateConnectedTokens: async () => {
        throw new Error('should not preserve connected session tokens on invalid refresh');
      },
    } as never, noopTransaction);

    await assert.rejects(() => service.refreshConnectedSession(providerSession as never, { force: true }));
    assert.ok(reauthParams);
    const capturedReauth: ReauthParams = reauthParams;
    assert.equal(capturedReauth.profileId, 'profile-1');
    assert.equal(capturedReauth.provider, 'trakt');
    assert.equal(capturedReauth.providerUserId, 'user-1');
    assert.equal(capturedReauth.externalUsername, 'crispy');
    assert.equal(capturedReauth.credentialsJson.lastImportJobId, 'job-1');
    assert.equal(capturedReauth.credentialsJson.lastImportCompletedAt, '2026-04-14T15:20:00.000Z');
    assert.equal(capturedReauth.lastRefreshError, 'invalid_grant');
    assert.equal(typeof capturedReauth.lastRefreshAt, 'string');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('refreshConnectedSession keeps session connected when refresh failure is transient', async () => {
  const { ProviderTokenRefreshService } = await import('./provider-token-refresh.service.js');
  const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const providerSession = {
    ...connectedSession,
    credentialsJson: { accessToken: 'access', refreshToken: 'refresh', accessTokenExpiresAt: futureDate },
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('gateway timeout', { status: 502, headers: { 'content-type': 'text/plain' } })) as typeof fetch;

  let updateParams: UpdateParams | null = null;
  let reauth = false;

  try {
    const service = new ProviderTokenRefreshService({
      updateConnectedTokens: async (_client: unknown, params: UpdateParams) => {
        updateParams = params;
        return { ...providerSession, credentialsJson: params.credentialsJson, lastRefreshAt: params.lastRefreshAt, lastRefreshError: params.credentialsJson.lastRefreshError as string | null };
      },
      markReauthRequired: async () => {
        reauth = true;
        return null as never;
      },
    } as never, noopTransaction);

    await assert.rejects(() => service.refreshConnectedSession(providerSession as never, { force: true }));
    assert.equal(reauth, false);
    assert.ok(updateParams);
    const capturedUpdate: UpdateParams = updateParams;
    assert.equal(capturedUpdate.profileId, 'profile-1');
    assert.equal(capturedUpdate.provider, 'trakt');
    assert.equal(capturedUpdate.credentialsJson.lastRefreshError, 'Unable to refresh the Trakt access token.');
    assert.equal(typeof capturedUpdate.lastRefreshAt, 'string');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
