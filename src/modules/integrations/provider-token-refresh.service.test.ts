import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

type RevokeParams = {
  providerAccountId: string;
  providerUserId?: string | null;
  externalUsername?: string | null;
  lastUsedAt?: string | null;
  credentialsJson?: Record<string, unknown>;
};

type UpdateParams = {
  providerAccountId: string;
  credentialsJson: Record<string, unknown>;
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

test('refreshProviderAccountById returns null for non-existent account', async () => {
  const { ProviderTokenRefreshService } = await import('./provider-token-refresh.service.js');
  const service = new ProviderTokenRefreshService({ findById: async () => null } as never, noopTransaction);
  const result = await service.refreshProviderAccountById('missing-account');
  assert.equal(result, null);
});

test('refreshProviderAccountById returns null for non-connected status', async () => {
  const { ProviderTokenRefreshService } = await import('./provider-token-refresh.service.js');
  const service = new ProviderTokenRefreshService({
    findById: async () => ({ id: 'acct-1', status: 'expired', provider: 'trakt', credentialsJson: {} }),
  } as never, noopTransaction);
  const result = await service.refreshProviderAccountById('acct-1');
  assert.equal(result, null);
});

test('refreshProviderAccount skips refresh when token is not expiring', async () => {
  const { ProviderTokenRefreshService } = await import('./provider-token-refresh.service.js');
  const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const providerAccount = {
    id: 'acct-1', status: 'connected', provider: 'trakt',
    credentialsJson: { accessToken: 'access', refreshToken: 'refresh', accessTokenExpiresAt: futureDate },
  };
  const service = new ProviderTokenRefreshService({} as never, noopTransaction);

  const result = await service.refreshProviderAccount(providerAccount as never);
  assert.equal(result.refreshed, false);
});

test('refreshProviderAccount forces refresh when force option is set', async () => {
  const { ProviderTokenRefreshService } = await import('./provider-token-refresh.service.js');
  const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const providerAccount = {
    id: 'acct-1', status: 'connected', provider: 'trakt',
    credentialsJson: { accessToken: 'access', refreshToken: 'refresh', accessTokenExpiresAt: futureDate },
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 })) as typeof fetch;

  try {
    const service = new ProviderTokenRefreshService({
      updateConnectedCredentials: async () => ({ ...providerAccount, credentialsJson: { ...providerAccount.credentialsJson, accessToken: 'new-access' } }),
    } as never, noopTransaction);

    const result = await service.refreshProviderAccount(providerAccount as never, { force: true });
    assert.equal(result.refreshed, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('refreshProviderAccount returns refreshed false when no refresh token exists', async () => {
  const { ProviderTokenRefreshService } = await import('./provider-token-refresh.service.js');
  const providerAccount = {
    id: 'acct-1', status: 'connected', provider: 'trakt',
    credentialsJson: { accessToken: 'access' },
  };
  const service = new ProviderTokenRefreshService({} as never, noopTransaction);

  const result = await service.refreshProviderAccount(providerAccount as never);
  assert.equal(result.refreshed, false);
});

test('refreshProviderAccount forces refresh for simkl when force option is set', async () => {
  const { ProviderTokenRefreshService } = await import('./provider-token-refresh.service.js');
  const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const providerAccount = {
    id: 'acct-1', status: 'connected', provider: 'simkl',
    credentialsJson: { accessToken: 'access', refreshToken: 'refresh', accessTokenExpiresAt: futureDate },
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({ access_token: 'new-simkl-access', refresh_token: 'new-simkl-refresh', expires_in: 3600 })) as typeof fetch;

  try {
    const service = new ProviderTokenRefreshService({
      updateConnectedCredentials: async () => ({ ...providerAccount, credentialsJson: { ...providerAccount.credentialsJson, accessToken: 'new-simkl-access' } }),
    } as never, noopTransaction);

    const result = await service.refreshProviderAccount(providerAccount as never, { force: true });
    assert.equal(result.refreshed, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('refreshProviderAccount revokes trakt connection when refresh token is invalid', async () => {
  const { ProviderTokenRefreshService } = await import('./provider-token-refresh.service.js');
  const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const providerAccount = {
    id: 'acct-1',
    status: 'connected',
    provider: 'trakt',
    profileId: 'profile-1',
    providerUserId: 'user-1',
    externalUsername: 'crispy',
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

  let revokedParams: RevokeParams | null = null;

  try {
    const service = new ProviderTokenRefreshService({
      revokeProviderAccount: async (_client: unknown, params: RevokeParams) => {
        revokedParams = params;
        return { ...providerAccount, status: 'revoked', providerUserId: null, externalUsername: null, credentialsJson: params.credentialsJson ?? {} };
      },
      updateConnectedCredentials: async () => {
        throw new Error('should not preserve connected credentials on invalid refresh');
      },
    } as never, noopTransaction);

    await assert.rejects(() => service.refreshProviderAccount(providerAccount as never, { force: true }));
    assert.ok(revokedParams);
    const capturedRevoke: RevokeParams = revokedParams;
    assert.equal(capturedRevoke.providerAccountId, 'acct-1');
    assert.equal(capturedRevoke.providerUserId, null);
    assert.equal(capturedRevoke.externalUsername, null);
    assert.equal(capturedRevoke.credentialsJson?.lastImportJobId, 'job-1');
    assert.equal(capturedRevoke.credentialsJson?.lastImportCompletedAt, '2026-04-14T15:20:00.000Z');
    assert.equal(capturedRevoke.credentialsJson?.lastRefreshError, 'invalid_grant');
    assert.equal(typeof capturedRevoke.credentialsJson?.lastRefreshAt, 'string');
    assert.equal(typeof capturedRevoke.credentialsJson?.revokedAt, 'string');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('refreshProviderAccount keeps connection when refresh failure is transient', async () => {
  const { ProviderTokenRefreshService } = await import('./provider-token-refresh.service.js');
  const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const providerAccount = {
    id: 'acct-1',
    status: 'connected',
    provider: 'trakt',
    profileId: 'profile-1',
    providerUserId: 'user-1',
    externalUsername: 'crispy',
    credentialsJson: { accessToken: 'access', refreshToken: 'refresh', accessTokenExpiresAt: futureDate },
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('gateway timeout', { status: 502, headers: { 'content-type': 'text/plain' } })) as typeof fetch;

  let updateParams: UpdateParams | null = null;
  let revoked = false;

  try {
    const service = new ProviderTokenRefreshService({
      updateConnectedCredentials: async (_client: unknown, params: UpdateParams) => {
        updateParams = params;
        return { ...providerAccount, credentialsJson: params.credentialsJson };
      },
      revokeProviderAccount: async () => {
        revoked = true;
        return null;
      },
    } as never, noopTransaction);

    await assert.rejects(() => service.refreshProviderAccount(providerAccount as never, { force: true }));
    assert.equal(revoked, false);
    assert.ok(updateParams);
    const capturedUpdate: UpdateParams = updateParams;
    assert.equal(capturedUpdate.providerAccountId, 'acct-1');
    assert.equal(capturedUpdate.credentialsJson.lastRefreshError, 'Unable to refresh the Trakt access token.');
    assert.equal(typeof capturedUpdate.credentialsJson.lastRefreshAt, 'string');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
