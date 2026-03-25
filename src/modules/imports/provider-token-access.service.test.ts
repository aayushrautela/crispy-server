import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from '../../lib/errors.js';
import type { ProviderImportConnectionRecord } from './provider-import-connections.repo.js';

function seedTestEnv(): void {
  process.env.NODE_ENV ??= 'test';
  process.env.DATABASE_URL ??= 'postgres://test:test@127.0.0.1:5432/test';
  process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/0';
  process.env.SUPABASE_URL ??= 'https://example.supabase.co';
  process.env.AUTH_JWT_AUDIENCE ??= 'authenticated';
  process.env.TMDB_API_KEY ??= 'tmdb-test-key';
  process.env.SERVICE_CLIENTS_JSON ??= '[{"serviceId":"test-service","apiKey":"test-key","scopes":["profiles:read"]}]';
}

async function loadService() {
  seedTestEnv();
  return import('./provider-token-access.service.js');
}

function createConnection(overrides: Partial<ProviderImportConnectionRecord> = {}): ProviderImportConnectionRecord {
  return {
    id: 'connection-1',
    profileId: 'profile-1',
    provider: 'trakt',
    status: 'connected',
    stateToken: null,
    providerUserId: 'provider-user',
    externalUsername: 'crispy',
    credentialsJson: {
      accessToken: 'access-123',
      refreshToken: 'refresh-123',
      accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      lastRefreshAt: '2026-03-24T00:00:00.000Z',
      lastRefreshError: null,
    },
    createdByUserId: 'user-1',
    expiresAt: null,
    lastUsedAt: '2026-03-24T00:10:00.000Z',
    createdAt: '2026-03-24T00:00:00.000Z',
    updatedAt: '2026-03-24T00:10:00.000Z',
    ...overrides,
  };
}

test('getConnectionForAccountProfile returns connected token metadata', async () => {
  const { ProviderTokenAccessService } = await loadService();
  const connection = createConnection();
  const service = new ProviderTokenAccessService(
    { findByIdForOwnerUser: async () => ({ id: 'profile-1' }) } as never,
    { findLatestConnectedForProfile: async () => connection } as never,
    { getRecommendedDelayMs: () => 30000 } as never,
    async (work) => work({} as never),
  );

  const result = await service.getConnectionForAccountProfile('account-1', 'profile-1', 'trakt');
  assert.equal(result.connectionId, 'connection-1');
  assert.equal(result.hasAccessToken, true);
  assert.equal(result.hasRefreshToken, true);
  assert.equal(result.recommendedRefreshDelayMs, 30000);
});

test('getAccessTokenForAccountProfile forces refresh and returns refreshed token', async () => {
  const { ProviderTokenAccessService } = await loadService();
  const initial = createConnection({
    credentialsJson: {
      accessToken: 'old-token',
      refreshToken: 'refresh-123',
      accessTokenExpiresAt: new Date(Date.now() - 60 * 1000).toISOString(),
    },
  });
  const refreshed = createConnection({
    credentialsJson: {
      accessToken: 'new-token',
      refreshToken: 'refresh-123',
      accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    },
  });

  const service = new ProviderTokenAccessService(
    { findByIdForOwnerUser: async () => ({ id: 'profile-1' }) } as never,
    { findLatestConnectedForProfile: async () => initial } as never,
    {
      refreshConnection: async (_connection: ProviderImportConnectionRecord, options?: { force?: boolean }) => {
        assert.equal(options?.force, true);
        return { connection: refreshed, refreshed: true };
      },
      getRecommendedDelayMs: () => 30000,
    } as never,
    async (work) => work({} as never),
  );

  const result = await service.getAccessTokenForAccountProfile('account-1', 'profile-1', 'trakt', { forceRefresh: true });
  assert.deepEqual(result, {
    connectionId: 'connection-1',
    profileId: 'profile-1',
    provider: 'trakt',
    accessToken: 'new-token',
    accessTokenExpiresAt: refreshed.credentialsJson.accessTokenExpiresAt,
    refreshed: true,
  });
});

test('getTokenStatusForAccountProfile reports expiring state', async () => {
  const { ProviderTokenAccessService } = await loadService();
  const expiring = createConnection({
    credentialsJson: {
      accessToken: 'access-123',
      refreshToken: 'refresh-123',
      accessTokenExpiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    },
  });
  const service = new ProviderTokenAccessService(
    { findByIdForOwnerUser: async () => ({ id: 'profile-1' }) } as never,
    { findLatestConnectedForProfile: async () => expiring } as never,
    { getRecommendedDelayMs: () => 30000 } as never,
    async (work) => work({} as never),
  );

  const result = await service.getTokenStatusForAccountProfile('account-1', 'profile-1', 'trakt');
  assert.equal(result.tokenState, 'expiring');
  assert.equal(result.canRefresh, true);
});

test('getConnectionForAccountProfile rejects missing connection', async () => {
  const { ProviderTokenAccessService } = await loadService();
  const service = new ProviderTokenAccessService(
    { findByIdForOwnerUser: async () => ({ id: 'profile-1' }) } as never,
    { findLatestConnectedForProfile: async () => null } as never,
    {} as never,
    async (work) => work({} as never),
  );

  await assert.rejects(() => service.getConnectionForAccountProfile('account-1', 'profile-1', 'trakt'), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.statusCode, 404);
    assert.equal(error.message, 'Provider connection not found.');
    return true;
  });
});

test('getAccessTokenForAccountProfile preserves upstream refresh details for admin diagnostics', async () => {
  const { ProviderTokenAccessService } = await loadService();
  const service = new ProviderTokenAccessService(
    { findByIdForOwnerUser: async () => ({ id: 'profile-1' }) } as never,
    { findLatestConnectedForProfile: async () => createConnection() } as never,
    {
      refreshConnection: async () => {
        throw new HttpError(401, 'invalid_grant', {
          provider: 'trakt',
          providerStatus: 401,
          responseBody: '{"error":"invalid_grant"}',
        });
      },
      getRecommendedDelayMs: () => 30000,
    } as never,
    async (work) => work({} as never),
  );

  await assert.rejects(() => service.getAccessTokenForAccountProfile('account-1', 'profile-1', 'trakt', { forceRefresh: true }), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.statusCode, 502);
    assert.equal(error.message, 'invalid_grant');
    assert.deepEqual(error.details, {
      provider: 'trakt',
      providerStatus: 401,
      responseBody: '{"error":"invalid_grant"}',
      upstreamStatusCode: 401,
    });
    return true;
  });
});
