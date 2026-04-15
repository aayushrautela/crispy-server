import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

const { ProviderAdminService } = await import('./provider-admin.service.js');

const session = {
  profileId: 'p1',
  provider: 'trakt',
  state: 'connected',
  providerAccountId: null,
  providerUserId: 'user-1',
  externalUsername: 'crispy',
  credentialsJson: {
    accessToken: 'token',
    refreshToken: 'refresh',
    accessTokenExpiresAt: new Date(Date.now() + 3600000).toISOString(),
  },
  stateToken: null,
  expiresAt: null,
  lastRefreshAt: '2026-04-14T15:20:00.000Z',
  lastRefreshError: null,
  lastImportCompletedAt: '2026-04-14T15:20:00.000Z',
  disconnectedAt: null,
  createdAt: '2026-04-14T15:20:00.000Z',
  updatedAt: '2026-04-14T15:20:00.000Z',
};

test('listConnections maps provider sessions to diagnostics', async () => {
  const service = new ProviderAdminService(
    { listAll: async () => [session] } as never,
    { listAdminJobs: async () => [] } as never,
    { getRecommendedDelayMs: () => 60000 } as never,
    async (work) => work({} as never),
  );

  const result = await service.listConnections();
  assert.deepEqual(result.connections, [{
    profileId: 'p1',
    provider: 'trakt',
    state: 'connected',
    providerUserId: 'user-1',
    externalUsername: 'crispy',
    accessTokenExpiresAt: session.credentialsJson.accessTokenExpiresAt,
    hasAccessToken: true,
    hasRefreshToken: true,
    lastRefreshAt: '2026-04-14T15:20:00.000Z',
    lastRefreshError: null,
    recommendedRefreshDelayMs: 60000,
    lastImportCompletedAt: '2026-04-14T15:20:00.000Z',
    connected: true,
    updatedAt: '2026-04-14T15:20:00.000Z',
  }]);
});

test('listConnections filters refresh failures and expiring tokens in memory', async () => {
  let calls = 0;
  const service = new ProviderAdminService(
    {
      listAll: async () => {
        calls += 1;
        return [
          session,
          {
            ...session,
            provider: 'simkl',
            state: 'reauth_required',
            credentialsJson: {},
            lastRefreshError: 'bad refresh',
          },
        ];
      },
    } as never,
    { listAdminJobs: async () => [] } as never,
    { getRecommendedDelayMs: () => null } as never,
    async (work) => work({} as never),
  );

  const failures = await service.listConnections({ refreshFailuresOnly: true });
  assert.equal(calls, 1);
  assert.equal(failures.connections.length, 1);
  assert.equal(failures.connections[0]?.provider, 'simkl');

  const expiring = await service.listConnections({ expiringWithinHours: 24 });
  assert.equal(expiring.connections.length, 1);
  assert.equal(expiring.connections[0]?.provider, 'trakt');
});

test('listJobs delegates to repository', async () => {
  const jobs = [{ id: 'job-1', provider: 'trakt', status: 'succeeded' }];
  const service = new ProviderAdminService(
    { listAll: async () => [] } as never,
    { listAdminJobs: async () => jobs } as never,
    { getRecommendedDelayMs: () => null } as never,
    async (work) => work({} as never),
  );

  const result = await service.listJobs();
  assert.deepEqual(result.jobs, jobs);
});
