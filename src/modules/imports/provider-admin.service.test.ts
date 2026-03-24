import test from 'node:test';
import assert from 'node:assert/strict';

function seedTestEnv(): void {
  process.env.NODE_ENV ??= 'test';
  process.env.DATABASE_URL ??= 'postgres://test:test@127.0.0.1:5432/test';
  process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/0';
  process.env.SUPABASE_URL ??= 'https://example.supabase.co';
  process.env.SUPABASE_JWKS_URL ??= 'https://example.supabase.co/auth/v1/.well-known/jwks.json';
  process.env.SUPABASE_JWT_ISSUER ??= 'https://example.supabase.co/auth/v1';
  process.env.SUPABASE_JWT_AUDIENCE ??= 'authenticated';
  process.env.TMDB_API_KEY ??= 'tmdb-test-key';
  process.env.SERVICE_CLIENTS_JSON ??= '[{"serviceId":"test-service","apiKey":"test-key","scopes":["profiles:read"]}]';
}

async function loadService() {
  seedTestEnv();
  return import('./provider-admin.service.js');
}

test('listConnections forwards admin filters to repository', async () => {
  const { ProviderAdminService } = await loadService();
  const service = new ProviderAdminService(
    {
      listAdminConnections: async (_client: unknown, filters: Record<string, unknown>) => {
        assert.equal(filters.provider, 'trakt');
        assert.equal(filters.status, 'connected');
        assert.equal(filters.refreshFailuresOnly, true);
        assert.equal(typeof filters.expiringBefore, 'string');
        assert.equal(filters.limit, 25);
        return [{ id: 'connection-1', profileId: 'profile-1', provider: 'trakt', status: 'connected', stateToken: null, providerUserId: 'user-1', externalUsername: 'crispy', credentialsJson: {}, createdByUserId: 'creator-1', expiresAt: null, lastUsedAt: null, createdAt: 'a', updatedAt: 'b', accessTokenExpiresAt: null, lastRefreshAt: null, lastRefreshError: null, lastImportJobId: null, lastImportCompletedAt: null, hasAccessToken: true, hasRefreshToken: true }];
      },
    } as never,
    {} as never,
    async (work) => work({} as never),
  );

  const result = await service.listConnections({
    provider: 'trakt',
    status: 'connected',
    expiringWithinHours: 1,
    refreshFailuresOnly: true,
    limit: 25,
  });
  assert.equal(result.connections[0]?.id, 'connection-1');
});

test('listJobs forwards admin filters to repository', async () => {
  const { ProviderAdminService } = await loadService();
  const service = new ProviderAdminService(
    {} as never,
    {
      listAdminJobs: async (_client: unknown, filters: Record<string, unknown>) => {
        assert.equal(filters.provider, 'simkl');
        assert.equal(filters.status, 'failed');
        assert.equal(filters.failuresOnly, true);
        assert.equal(filters.limit, 10);
        return [{ id: 'job-1', profileId: 'profile-1', householdId: 'household-1', provider: 'simkl', mode: 'replace_import', status: 'failed', requestedByUserId: 'user-1', connectionId: 'connection-1', checkpointJson: {}, summaryJson: {}, errorJson: {}, createdAt: 'a', startedAt: null, finishedAt: null, updatedAt: 'b', errorCode: 'provider_error', errorMessage: 'boom' }];
      },
    } as never,
    async (work) => work({} as never),
  );

  const result = await service.listJobs({ provider: 'simkl', status: 'failed', failuresOnly: true, limit: 10 });
  assert.equal(result.jobs[0]?.errorCode, 'provider_error');
});
