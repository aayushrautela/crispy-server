import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

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
