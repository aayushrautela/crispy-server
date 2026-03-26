import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

const { RecommendationAdminService } = await import('./recommendation-admin.service.js');

test('listConsumers returns consumers from repository', async () => {
  const consumers = [{ id: 'c1', sourceKey: 'default', status: 'active' }];
  const service = new RecommendationAdminService(
    { listAll: async () => consumers } as never,
    {} as never,
    {} as never,
    async (work) => work({} as never),
  );

  const result = await service.listConsumers();
  assert.deepEqual(result.consumers, consumers);
});

test('getWorkState returns active leases, stale leases, and backlog', async () => {
  const service = new RecommendationAdminService(
    {} as never,
    {
      listActiveLeases: async () => [{ leaseId: 'lease-1' }],
      listStaleLeases: async () => [{ leaseId: 'lease-stale' }],
      listBacklogSummaries: async () => [{ sourceKey: 'default', pendingCount: 5 }],
    } as never,
    {} as never,
    async (work) => work({} as never),
  );

  const result = await service.getWorkState();
  assert.equal(result.activeLeases.length, 1);
  assert.equal(result.staleLeases.length, 1);
  assert.equal(result.backlog.length, 1);
});

test('getOutbox returns lag summary and undelivered events', async () => {
  const service = new RecommendationAdminService(
    {} as never,
    {} as never,
    {
      getLagSummary: async () => ({ undeliveredCount: 3, oldestUndeliveredAt: '2026-03-24T00:00:00.000Z' }),
      listUndelivered: async () => [{ id: 'event-1' }],
    } as never,
    async (work) => work({} as never),
  );

  const result = await service.getOutbox();
  assert.equal(result.lag.undeliveredCount, 3);
  assert.equal(result.undelivered.length, 1);
});

test('listConsumers passes limit to repository', async () => {
  let receivedLimit: number | undefined;
  const service = new RecommendationAdminService(
    { listAll: async (_client: unknown, limit: number) => { receivedLimit = limit; return []; } } as never,
    {} as never,
    {} as never,
    async (work) => work({} as never),
  );

  await service.listConsumers(50);
  assert.equal(receivedLimit, 50);
});
