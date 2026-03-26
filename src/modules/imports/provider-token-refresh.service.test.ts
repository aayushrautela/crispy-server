import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv({ TRAKT_IMPORT_CLIENT_ID: 'trakt-id', TRAKT_IMPORT_CLIENT_SECRET: 'trakt-secret', SIMKL_IMPORT_CLIENT_ID: 'simkl-id', SIMKL_IMPORT_CLIENT_SECRET: 'simkl-secret' });

test('refreshConnectionById returns null for non-existent connection', async () => {
  const { ProviderTokenRefreshService } = await import('./provider-token-refresh.service.js');
  const service = new ProviderTokenRefreshService({ findById: async () => null } as never);
  const result = await service.refreshConnectionById('missing-conn');
  assert.equal(result, null);
});

test('refreshConnectionById returns null for non-connected status', async () => {
  const { ProviderTokenRefreshService } = await import('./provider-token-refresh.service.js');
  const service = new ProviderTokenRefreshService({
    findById: async () => ({ id: 'conn-1', status: 'expired', provider: 'trakt', credentialsJson: {} }),
  } as never);
  const result = await service.refreshConnectionById('conn-1');
  assert.equal(result, null);
});

test('refreshConnection skips refresh when token is not expiring', async () => {
  const { ProviderTokenRefreshService } = await import('./provider-token-refresh.service.js');
  const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const connection = {
    id: 'conn-1', status: 'connected', provider: 'trakt',
    credentialsJson: { accessToken: 'access', refreshToken: 'refresh', accessTokenExpiresAt: futureDate },
  };
  const service = new ProviderTokenRefreshService({} as never);

  const result = await service.refreshConnection(connection as never);
  assert.equal(result.refreshed, false);
});

test('refreshConnection forces refresh when force option is set', async () => {
  const { ProviderTokenRefreshService } = await import('./provider-token-refresh.service.js');
  const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const connection = {
    id: 'conn-1', status: 'connected', provider: 'trakt',
    credentialsJson: { accessToken: 'access', refreshToken: 'refresh', accessTokenExpiresAt: futureDate },
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 })) as typeof fetch;

  try {
    const service = new ProviderTokenRefreshService({
      updateConnectedCredentials: async () => ({ ...connection, credentialsJson: { ...connection.credentialsJson, accessToken: 'new-access' } }),
    } as never);

    const result = await service.refreshConnection(connection as never, { force: true });
    assert.equal(result.refreshed, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('refreshConnection returns refreshed false when no refresh token exists', async () => {
  const { ProviderTokenRefreshService } = await import('./provider-token-refresh.service.js');
  const connection = {
    id: 'conn-1', status: 'connected', provider: 'trakt',
    credentialsJson: { accessToken: 'access' },
  };
  const service = new ProviderTokenRefreshService({} as never);

  const result = await service.refreshConnection(connection as never);
  assert.equal(result.refreshed, false);
});
