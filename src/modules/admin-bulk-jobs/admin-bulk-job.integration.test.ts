import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, beforeEach, test } from 'node:test';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

const { db } = await import('../../lib/db.js');
const { AdminBulkJobService } = await import('./admin-bulk-job.service.js');
const { AdminBulkJobWorker } = await import('./admin-bulk-job-worker.js');

const TEST_ADMIN_ID = 'admin-bulk-job-integration-test';

type TargetInput = { accountId: string; profileId: string };

function target(): TargetInput {
  return { accountId: randomUUID(), profileId: randomUUID() };
}

function targetStatus(row: unknown): string {
  if (!row || typeof row !== 'object' || !('status' in row)) {
    throw new Error('Invalid target row');
  }
  const status = row.status;
  if (typeof status !== 'string') {
    throw new Error('Invalid status type');
  }
  return status;
}

async function cleanup(): Promise<void> {
  await db.query(
    `DELETE FROM service_outbox_events
     WHERE correlation_id LIKE 'admin-bulk-it-%'
        OR bulk_job_id IN (SELECT id FROM admin_bulk_jobs WHERE requested_by_admin_id = $1)`,
    [TEST_ADMIN_ID],
  );
  await db.query('DELETE FROM admin_bulk_jobs WHERE requested_by_admin_id = $1', [TEST_ADMIN_ID]);
}

async function processUntilIdle(worker: InstanceType<typeof AdminBulkJobWorker>, maxPasses = 5): Promise<void> {
  for (let index = 0; index < maxPasses; index += 1) {
    const result = await worker.processNextJob();
    if (!result.processed) {
      return;
    }
  }
}

beforeEach(async () => {
  await cleanup();
});

after(async () => {
  await cleanup();
  await db.end();
});

test('admin bulk recompute creates a job, worker processes targets, and outbox events are created', { concurrency: false }, async () => {
  const service = new AdminBulkJobService();
  const worker = new AdminBulkJobWorker();
  const targets = [target(), target()];

  const created = await service.createRecommendationRecomputeJob({
    scope: { type: 'explicit_targets' },
    targets,
    reason: 'refresh stale recommendations',
    correlationId: 'admin-bulk-it-create-worker-outbox',
    requestedByAdminId: TEST_ADMIN_ID,
  });

  assert.equal(created.created, true);
  assert.equal(created.coalescedWithExistingJob, false);
  assert.equal(created.job.status, 'queued');
  assert.equal(created.job.targetsTotal, 2);
  assert.equal(created.job.targetsQueued, 2);

  await processUntilIdle(worker);

  const detail = await service.getJobDetail(created.job.id);
  assert.equal(detail.job.status, 'completed');
  assert.equal(detail.job.targetsTotal, 2);
  assert.equal(detail.job.targetsQueued, 0);
  assert.equal(detail.job.targetsOutboxed, 2);
  assert.equal(detail.outboxProgress.pending, 2);
  assert.equal(detail.outboxProgress.total, 2);
  assert.deepEqual(detail.targets.map(targetStatus), ['outboxed', 'outboxed']);

  const outbox = await db.query(
    `SELECT event_type, event_version, aggregate_type, user_id::text AS user_id, profile_id::text AS profile_id,
            payload, destination, correlation_id, bulk_job_id::text AS bulk_job_id, bulk_job_target_id::text AS bulk_job_target_id,
            idempotency_key
     FROM service_outbox_events
     WHERE bulk_job_id = $1::uuid
     ORDER BY profile_id ASC`,
    [created.job.id],
  );

  assert.equal(outbox.rowCount, 2);
  for (const row of outbox.rows) {
    assert.equal(row.event_type, 'recommendation.recompute_requested');
    assert.equal(row.event_version, 1);
    assert.equal(row.aggregate_type, 'profile');
    assert.equal(row.destination, 'recommender');
    assert.equal(row.correlation_id, 'admin-bulk-it-create-worker-outbox');
    assert.equal(row.bulk_job_id, created.job.id);
    assert.equal(typeof row.bulk_job_target_id, 'string');
    assert.equal(typeof row.idempotency_key, 'string');
    assert.deepEqual(row.payload, { reason: 'admin_requested' });
  }
});

test('admin bulk recompute coalesces duplicate active requests', { concurrency: false }, async () => {
  const service = new AdminBulkJobService();
  const targets = [target(), target()];

  const first = await service.createRecommendationRecomputeJob({
    scope: { type: 'explicit_targets' },
    targets,
    reason: 'same reason',
    idempotencyKey: 'admin-bulk-it-coalesce-first',
    correlationId: 'admin-bulk-it-coalesce',
    requestedByAdminId: TEST_ADMIN_ID,
  });
  const second = await service.createRecommendationRecomputeJob({
    scope: { type: 'explicit_targets' },
    targets: [...targets].reverse(),
    reason: 'same reason',
    idempotencyKey: 'admin-bulk-it-coalesce-second',
    correlationId: 'admin-bulk-it-coalesce-duplicate',
    requestedByAdminId: TEST_ADMIN_ID,
  });

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.coalescedWithExistingJob, true);
  assert.equal(second.job.id, first.job.id);

  const counts = await db.query(
    `SELECT
       (SELECT count(*)::int FROM admin_bulk_jobs WHERE requested_by_admin_id = $1) AS job_count,
       (SELECT count(*)::int FROM admin_bulk_job_targets WHERE bulk_job_id = $2::uuid) AS target_count,
       (SELECT count(*)::int FROM admin_bulk_job_requests WHERE bulk_job_id = $2::uuid) AS request_count,
       (SELECT count(*)::int FROM admin_bulk_job_events WHERE bulk_job_id = $2::uuid AND event_type = 'coalesced') AS coalesced_event_count`,
    [TEST_ADMIN_ID, first.job.id],
  );

  assert.equal(counts.rows[0].job_count, 1);
  assert.equal(counts.rows[0].target_count, 2);
  assert.equal(counts.rows[0].request_count, 2);
  assert.equal(counts.rows[0].coalesced_event_count, 1);
});

test('admin bulk recompute supports pause, resume, and cancel controls', { concurrency: false }, async () => {
  const service = new AdminBulkJobService();
  const worker = new AdminBulkJobWorker();
  const created = await service.createRecommendationRecomputeJob({
    scope: { type: 'explicit_targets' },
    targets: [target(), target(), target()],
    reason: 'operator control test',
    correlationId: 'admin-bulk-it-controls',
    requestedByAdminId: TEST_ADMIN_ID,
  });

  const paused = await service.controlJob(created.job.id, 'pause');
  assert.equal(paused.status, 'paused');
  assert.equal(typeof paused.pauseRequestedAt, 'string');

  const whilePaused = await worker.processNextJob();
  assert.equal(whilePaused.processed, false);

  const resumed = await service.controlJob(created.job.id, 'resume');
  assert.equal(resumed.status, 'queued');
  assert.equal(typeof resumed.resumeRequestedAt, 'string');

  const canceling = await service.controlJob(created.job.id, 'cancel');
  assert.equal(canceling.status, 'canceling');
  assert.equal(typeof canceling.cancelRequestedAt, 'string');

  await processUntilIdle(worker);

  const detail = await service.getJobDetail(created.job.id);
  assert.equal(detail.job.status, 'canceled');
  assert.equal(detail.job.targetsCanceled, 3);
  assert.equal(detail.outboxProgress.total, 0);
  assert.deepEqual(detail.targets.map(targetStatus), ['canceled', 'canceled', 'canceled']);

  const events = await db.query(
    `SELECT event_type FROM admin_bulk_job_events WHERE bulk_job_id = $1::uuid ORDER BY created_at ASC`,
    [created.job.id],
  );
  assert.deepEqual(events.rows.map((row) => row.event_type), ['created', 'paused', 'resumed', 'cancel_requested', 'canceled']);
});
