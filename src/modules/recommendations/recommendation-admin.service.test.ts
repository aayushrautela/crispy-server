import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

const { RecommendationAdminService } = await import('./recommendation-admin.service.js');

async function runInTransaction<T>(work: (client: never) => Promise<T>): Promise<T> {
  return work({} as never);
}

test('getOutbox returns lag summary and undelivered events', async () => {
  const service = new RecommendationAdminService(
    {
      getLagSummary: async () => ({ undeliveredCount: 3, oldestUndeliveredAt: '2026-03-24T00:00:00.000Z' }),
      listUndelivered: async () => [{ id: 'event-1' }],
    } as never,
    runInTransaction,
  );

  const result = await service.getOutbox();
  assert.equal(result.lag.undeliveredCount, 3);
  assert.equal(result.undelivered.length, 1);
});

test('getOutbox passes limit to repository', async () => {
  let receivedLimit: number | undefined;
  const service = new RecommendationAdminService(
    {
      getLagSummary: async () => ({ undeliveredCount: 0, oldestUndeliveredAt: null }),
      listUndelivered: async (_client: unknown, limit: number) => {
        receivedLimit = limit;
        return [];
      },
    } as never,
    runInTransaction,
  );

  await service.getOutbox(50);
  assert.equal(receivedLimit, 50);
});
