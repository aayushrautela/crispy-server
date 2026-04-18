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
    {
      getLagSummary: async () => ({ pendingCount: 0, queuedCount: 0, runningCount: 0, failedCount: 0, submitFailureCount: 0, pollFailureCount: 0, oldestPendingCreatedAt: null }),
      listRecent: async () => [],
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
    {
      getLagSummary: async () => ({ pendingCount: 0, queuedCount: 0, runningCount: 0, failedCount: 0, submitFailureCount: 0, pollFailureCount: 0, oldestPendingCreatedAt: null }),
      listRecent: async () => [],
    } as never,
    runInTransaction,
  );

  await service.getOutbox(50);
  assert.equal(receivedLimit, 50);
});

test('getGenerationJobs returns lag summary and due jobs', async () => {
  const service = new RecommendationAdminService(
    {
      getLagSummary: async () => ({ undeliveredCount: 0, oldestUndeliveredAt: null }),
      listUndelivered: async () => [],
    } as never,
    {
      getLagSummary: async () => ({ pendingCount: 1, queuedCount: 2, runningCount: 3, failedCount: 4, submitFailureCount: 5, pollFailureCount: 6, oldestPendingCreatedAt: '2026-03-24T00:00:00.000Z' }),
      listRecent: async () => [{ id: 'job-1' }],
    } as never,
    runInTransaction,
  );

  const result = await service.getGenerationJobs();
  assert.equal(result.lag.pendingCount, 1);
  assert.equal(result.jobs.length, 1);
});

test('getGenerationJob returns a single local recommendation generation job', async () => {
  const service = new RecommendationAdminService(
    {
      getLagSummary: async () => ({ undeliveredCount: 0, oldestUndeliveredAt: null }),
      listUndelivered: async () => [],
    } as never,
    {
      findById: async (_client: unknown, jobId: string) => ({ id: jobId, status: 'queued' }),
    } as never,
    runInTransaction,
  );

  const result = await service.getGenerationJob('job-123');
  assert.equal(result.job?.id, 'job-123');
});

test('clearBlockedGenerationJobs delegates to repository in a transaction', async () => {
  const service = new RecommendationAdminService(
    {
      getLagSummary: async () => ({ undeliveredCount: 0, oldestUndeliveredAt: null }),
      listUndelivered: async () => [],
    } as never,
    {
      clearBlockedForRetest: async () => ({ deletedCount: 4 }),
    } as never,
    runInTransaction,
  );

  const result = await service.clearBlockedGenerationJobs();
  assert.equal(result.deletedCount, 4);
});
