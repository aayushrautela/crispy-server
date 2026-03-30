import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

const { ProviderAdminService } = await import('./provider-admin.service.js');

test('listConnections delegates to repository', async () => {
  const connections = [{ accountId: 'a1', profileId: 'p1', provider: 'trakt', status: 'connected' }];
  const service = new ProviderAdminService(
    { listAdminConnections: async () => connections } as never,
    { listAdminJobs: async () => [] } as never,
    async (work) => work({} as never),
  );

  const result = await service.listConnections();
  assert.deepEqual(result.connections, connections);
});

test('listConnections passes filters to repository', async () => {
  let receivedFilters: unknown = null;
  const service = new ProviderAdminService(
    {
      listAdminConnections: async (_client: unknown, filters: unknown) => {
        receivedFilters = filters;
        return [];
      },
    } as never,
    { listAdminJobs: async () => [] } as never,
    async (work) => work({} as never),
  );

  await service.listConnections({ provider: 'trakt', status: 'connected', limit: 10 });
  assert.deepEqual(receivedFilters, {
    provider: 'trakt',
    status: 'connected',
    expiringBefore: null,
    refreshFailuresOnly: false,
    limit: 10,
  });
});

test('listJobs delegates to repository', async () => {
  const jobs = [{ id: 'job-1', provider: 'trakt', status: 'succeeded' }];
  const service = new ProviderAdminService(
    { listAdminConnections: async () => [] } as never,
    { listAdminJobs: async () => jobs } as never,
    async (work) => work({} as never),
  );

  const result = await service.listJobs();
  assert.deepEqual(result.jobs, jobs);
});

test('listConnections computes expiringBefore from hours', async () => {
  let receivedFilters: unknown = null;
  const service = new ProviderAdminService(
    {
      listAdminConnections: async (_client: unknown, filters: unknown) => {
        receivedFilters = filters;
        return [];
      },
    } as never,
    { listAdminJobs: async () => [] } as never,
    async (work) => work({} as never),
  );

  await service.listConnections({ expiringWithinHours: 24 });
  const filters = receivedFilters as any;
  assert.ok(filters.expiringBefore);
  const expiringDate = new Date(filters.expiringBefore);
  const now = new Date();
  const diffHours = (expiringDate.getTime() - now.getTime()) / (60 * 60 * 1000);
  assert.ok(diffHours >= 23 && diffHours <= 25);
});
