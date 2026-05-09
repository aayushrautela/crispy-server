import { randomUUID } from 'node:crypto';
import { withTransaction, type DbClient } from '../../lib/db.js';
import { RecommendationOutboxService } from '../outbox/recommendation-outbox.service.js';
import { AdminBulkJobRepository } from './admin-bulk-job.repo.js';
import type { AdminBulkJobRecord } from './admin-bulk-job.types.js';

const ENUMERATION_PAGE_SIZE = 100;
const FANOUT_BATCH_SIZE = 50;
const STALE_LOCK_SECONDS = 300;

export class AdminBulkJobWorker {
  constructor(
    private readonly repository = new AdminBulkJobRepository(),
    private readonly recommendationOutboxService = new RecommendationOutboxService(),
    private readonly runInTransaction = withTransaction,
  ) {}

  async processNextJob(): Promise<{ processed: boolean; jobId: string | null }> {
    return this.runInTransaction(async (client: DbClient) => {
      const job = await this.repository.claimNextJob(client, 'worker', STALE_LOCK_SECONDS);
      if (!job) {
        return { processed: false, jobId: null };
      }

      if (job.status === 'canceling') {
        await this.repository.cancelJob(client, job.id);
        await this.repository.recordEvent(client, { bulkJobId: job.id, eventType: 'canceled' });
        return { processed: true, jobId: job.id };
      }

      if (await this.repository.markPausedIfRequested(client, job.id)) {
        return { processed: true, jobId: job.id };
      }

      if (job.status === 'enumerating') {
        await this.processEnumeration(client, job);
        return { processed: true, jobId: job.id };
      }

      if (job.status === 'fanout') {
        await this.processFanout(client, job);
        return { processed: true, jobId: job.id };
      }

      return { processed: false, jobId: job.id };
    });
  }

  private async processEnumeration(client: DbClient, job: AdminBulkJobRecord): Promise<void> {
    if (job.scopeType === 'explicit_targets') {
      await this.repository.markEnumerationCompleted(client, job.id);
      return;
    }

    const scope = job.scopeType === 'tier' && job.tier
      ? { type: 'tier' as const, tier: job.tier }
      : { type: 'all_users' as const };

    const page = await this.repository.listProfileTargetsPage(client, {
      scope,
      cursor: job.enumerationCursor,
      limit: ENUMERATION_PAGE_SIZE,
    });

    if (page.length === 0) {
      await this.repository.markEnumerationCompleted(client, job.id);
      await this.repository.recordEvent(client, {
        bulkJobId: job.id,
        eventType: 'enumeration_completed',
        metadata: { totalTargets: job.targetsTotal },
      });
      return;
    }

    let insertedCount = 0;
    for (const target of page) {
      const inserted = await this.repository.insertTarget(client, job.id, target, job.reason);
      if (inserted) {
        insertedCount++;
      }
    }

    if (insertedCount > 0) {
      await this.repository.recordEvent(client, {
        bulkJobId: job.id,
        eventType: 'target_enumerated',
        metadata: { count: insertedCount },
      });
    }

    const lastCursor = page[page.length - 1]?.cursor ?? null;
    await this.repository.updateEnumerationCursor(client, job.id, lastCursor);

    if (page.length < ENUMERATION_PAGE_SIZE) {
      await this.repository.markEnumerationCompleted(client, job.id);
      await this.repository.recordEvent(client, {
        bulkJobId: job.id,
        eventType: 'enumeration_completed',
        metadata: { totalTargets: job.targetsTotal + insertedCount },
      });
    }
  }

  private async processFanout(client: DbClient, job: AdminBulkJobRecord): Promise<void> {
    if (await this.repository.markPausedIfRequested(client, job.id)) {
      return;
    }

    const targets = await this.repository.listQueuedTargetsAfterCursor(
      client,
      job.id,
      job.fanoutCursor,
      FANOUT_BATCH_SIZE,
    );

    if (targets.length === 0) {
      await this.repository.markFanoutCompleted(client, job.id);
      await this.repository.refreshCounters(client, job.id);
      await this.repository.recordEvent(client, {
        bulkJobId: job.id,
        eventType: 'fanout_completed',
        metadata: { totalOutboxed: job.targetsOutboxed },
      });
      await this.repository.recordEvent(client, {
        bulkJobId: job.id,
        eventType: 'completed',
      });
      return;
    }

    let outboxedCount = 0;
    let coalescedCount = 0;

    for (const target of targets) {
      if (job.cancelRequestedAt) {
        break;
      }

      try {
        const outboxEvent = await this.recommendationOutboxService.appendRecomputeRequested(client, {
          userId: target.accountId,
          profileId: target.profileId,
          reason: 'admin_requested',
          correlationId: job.requestCorrelationId ?? randomUUID(),
          bulkJobId: job.id,
          bulkJobTargetId: target.id,
          idempotencyKey: target.idempotencyKey,
        });

        await this.repository.markTargetOutboxed(client, {
          targetId: target.id,
          serviceOutboxId: outboxEvent.id,
          cursor: target.targetKey,
        });

        outboxedCount++;

        await this.repository.recordEvent(client, {
          bulkJobId: job.id,
          bulkJobTargetId: target.id,
          eventType: 'target_outboxed',
          metadata: { targetKey: target.targetKey, outboxId: outboxEvent.id },
        });
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
          const existingResult = await client.query(
            `SELECT id FROM service_outbox_events WHERE idempotency_key = $1 AND status IN ('pending', 'processing') LIMIT 1`,
            [target.idempotencyKey],
          );
          const existingId = existingResult.rows[0]?.id;
          if (existingId) {
            await this.repository.markTargetCoalesced(client, {
              targetId: target.id,
              serviceOutboxId: String(existingId),
            });
            coalescedCount++;
            await this.repository.recordEvent(client, {
              bulkJobId: job.id,
              bulkJobTargetId: target.id,
              eventType: 'target_coalesced',
              metadata: { targetKey: target.targetKey, existingOutboxId: String(existingId) },
            });
          }
        } else {
          throw error;
        }
      }
    }

    const lastCursor = targets[targets.length - 1]?.targetKey ?? null;
    await this.repository.updateFanoutCursor(client, job.id, lastCursor);
    await this.repository.refreshCounters(client, job.id);

    if (outboxedCount > 0 || coalescedCount > 0) {
      await this.repository.recordEvent(client, {
        bulkJobId: job.id,
        eventType: 'fanout_started',
        metadata: { outboxed: outboxedCount, coalesced: coalescedCount },
      });
    }
  }

  async getJobProgress(jobId: string): Promise<{
    job: AdminBulkJobRecord;
    outboxProgress: { pending: number; processing: number; dispatched: number; failed: number; total: number };
  }> {
    return this.runInTransaction(async (client: DbClient) => {
      const job = await this.repository.getJob(client, jobId);
      if (!job) {
        throw new Error('Job not found');
      }
      const outboxProgress = await this.repository.countLinkedOutboxEvents(client, jobId);
      return { job, outboxProgress };
    });
  }
}
