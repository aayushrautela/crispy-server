import { randomUUID } from 'node:crypto';
import { HttpError } from '../../lib/errors.js';
import { withTransaction, type DbClient } from '../../lib/db.js';
import {
  AdminBulkJobRepository,
  buildAdminBulkJobDedupeKey,
  buildAdminBulkJobRequestHash,
  normalizeTargets,
} from './admin-bulk-job.repo.js';
import type {
  AdminBulkJobRecord,
  AdminBulkJobScope,
  AdminBulkJobStatus,
  AdminBulkJobTargetInput,
  CreateAdminBulkJobInput,
} from './admin-bulk-job.types.js';

type AdminBulkJobAction = 'pause' | 'resume' | 'cancel';
type AdminBulkJobProgress = {
  targetTotal: number | null;
  queued: number;
  coalesced: number;
  outboxed: number;
  dispatched: number;
  failed: number;
  canceled: number;
  completed: number;
  percent: number | null;
};
type AdminBulkJobDetail = {
  job: AdminBulkJobRecord;
  targets: unknown[];
  events: unknown[];
  outboxProgress: { pending: number; processing: number; dispatched: number; failed: number; total: number };
  progress: AdminBulkJobProgress;
  diagnostics: {
    lastError: Record<string, unknown> | null;
    enumerationCursor: string | null;
    fanoutCursor: string | null;
    outboxProgress: { pending: number; processing: number; dispatched: number; failed: number; total: number };
  };
  availableActions: AdminBulkJobAction[];
};
type AdminBulkJobControlResult = AdminBulkJobRecord & { jobId: string; changed: boolean; job: AdminBulkJobRecord; availableActions: AdminBulkJobAction[] };

type TransactionRunner = <T>(work: (client: DbClient) => Promise<T>) => Promise<T>;

const MAX_EXPLICIT_TARGETS = 500;

export class AdminBulkJobService {
  constructor(
    private readonly repository = new AdminBulkJobRepository(),
    private readonly runInTransaction: TransactionRunner = withTransaction,
  ) {}

  async previewRecommendationRecomputeJob(input: CreateAdminBulkJobInput): Promise<{ scope: AdminBulkJobScope; targetCountEstimate: number | null; normalizedTargetCount: number; invalidTargetCount: number; limited: boolean }> {
    const targets = normalizeTargets(input.targets ?? []);
    const invalidTargetCount = Math.max(0, (input.targets ?? []).length - targets.length);
    const scope = this.validateScope(input.scope);
    if (scope.type === 'explicit_targets') {
      return { scope, targetCountEstimate: targets.length, normalizedTargetCount: targets.length, invalidTargetCount, limited: targets.length > MAX_EXPLICIT_TARGETS };
    }
    return { scope, targetCountEstimate: null, normalizedTargetCount: 0, invalidTargetCount: 0, limited: false };
  }

  async createRecommendationRecomputeJob(input: CreateAdminBulkJobInput): Promise<{ job: AdminBulkJobRecord; created: boolean; coalescedWithExistingJob: boolean }> {
    const scope = this.validateScope(input.scope);
    const targets = scope.type === 'explicit_targets' ? normalizeTargets(input.targets ?? []) : [];
    if (scope.type === 'explicit_targets' && targets.length === 0) {
      throw new HttpError(400, 'At least one target is required.');
    }
    if (targets.length > MAX_EXPLICIT_TARGETS) {
      throw new HttpError(400, `Maximum ${MAX_EXPLICIT_TARGETS} explicit targets allowed per bulk job.`);
    }

    const reason = input.reason?.trim() || null;
    const dedupeKey = buildAdminBulkJobDedupeKey(scope, targets, reason);
    const requestSnapshot = { scope, targets, reason, idempotencyKey: input.idempotencyKey ?? null };
    const requestHash = buildAdminBulkJobRequestHash(requestSnapshot);

    return this.runInTransaction(async (client) => {
      const existing = await this.repository.findActiveByDedupeKey(client, dedupeKey);
      if (existing) {
        await this.repository.insertRequest(client, {
          bulkJobId: existing.id,
          idempotencyKey: input.idempotencyKey ?? null,
          dedupeKey,
          requestHash,
          requestSnapshot,
          requestedByAdminId: input.requestedByAdminId ?? null,
        });
        await this.repository.recordEvent(client, { bulkJobId: existing.id, eventType: 'coalesced', metadata: { dedupeKey } });
        return { job: existing, created: false, coalescedWithExistingJob: true };
      }

      const job = await this.repository.createJob(client, {
        scope,
        dedupeKey,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: input.correlationId?.trim() || randomUUID(),
        reason,
        targetCountEstimate: scope.type === 'explicit_targets' ? targets.length : null,
        requestedByAdminId: input.requestedByAdminId ?? null,
      });
      await this.repository.insertRequest(client, {
        bulkJobId: job.id,
        idempotencyKey: input.idempotencyKey ?? null,
        dedupeKey,
        requestHash,
        requestSnapshot,
        requestedByAdminId: input.requestedByAdminId ?? null,
      });
      if (scope.type === 'explicit_targets') {
        await this.repository.insertTargets(client, job.id, targets, reason);
      }
      await this.repository.recordEvent(client, { bulkJobId: job.id, eventType: 'created', metadata: { targetCount: targets.length } });
      const reloaded = await this.repository.getJob(client, job.id);
      return { job: reloaded ?? job, created: true, coalescedWithExistingJob: false };
    });
  }

  async listJobs(filters: { status?: AdminBulkJobStatus | null; scope?: AdminBulkJobScope['type'] | null; limit?: number }): Promise<{ jobs: AdminBulkJobRecord[]; nextCursor: null }> {
    const limit = Math.max(1, Math.min(Math.trunc(filters.limit ?? 50), 100));
    const jobs = await this.runInTransaction((client) => this.repository.listJobs(client, { status: filters.status ?? null, scope: filters.scope ?? null, limit }));
    return { jobs, nextCursor: null };
  }

  async getJobDetail(jobId: string): Promise<AdminBulkJobDetail> {
    return this.runInTransaction(async (client) => {
      const job = await this.repository.getJob(client, jobId);
      if (!job) {
        throw new HttpError(404, 'Bulk job not found.');
      }
      await this.repository.refreshCounters(client, jobId);
      const [targets, events, outboxProgress, refreshedJob] = await Promise.all([
        this.repository.listTargets(client, jobId, 100),
        this.repository.listEvents(client, jobId, 50),
        this.repository.countLinkedOutboxEvents(client, jobId),
        this.repository.getJob(client, jobId),
      ]);
      const detailJob = refreshedJob ?? job;
      return {
        job: detailJob,
        targets,
        events,
        outboxProgress,
        progress: this.buildProgress(detailJob),
        diagnostics: {
          lastError: detailJob.lastError,
          enumerationCursor: detailJob.enumerationCursor,
          fanoutCursor: detailJob.fanoutCursor,
          outboxProgress,
        },
        availableActions: this.getAvailableActions(detailJob.status),
      };
    });
  }

  async controlJob(jobId: string, action: AdminBulkJobAction): Promise<AdminBulkJobControlResult> {
    return this.runInTransaction(async (client) => {
      const existing = await this.repository.getJob(client, jobId);
      if (!existing) {
        throw new HttpError(404, 'Bulk job not found.');
      }
      if (!this.getAvailableActions(existing.status).includes(action)) {
        return { ...existing, jobId: existing.id, changed: false, job: existing, availableActions: this.getAvailableActions(existing.status) };
      }

      const job = await this.repository.transitionJob(client, jobId, action);
      if (!job) {
        throw new HttpError(409, `Bulk job cannot be ${action}d from its current state.`);
      }
      await this.repository.recordEvent(client, {
        bulkJobId: job.id,
        eventType: action === 'cancel' ? 'cancel_requested' : action === 'pause' ? 'paused' : 'resumed',
      });
      return { ...job, jobId: job.id, changed: job.status !== existing.status, job, availableActions: this.getAvailableActions(job.status) };
    });
  }

  async reconcileJob(jobId: string): Promise<AdminBulkJobDetail> {
    await this.runInTransaction(async (client) => {
      const job = await this.repository.getJob(client, jobId);
      if (!job) {
        throw new HttpError(404, 'Bulk job not found.');
      }
      await this.repository.refreshCounters(client, jobId);
    });
    return this.getJobDetail(jobId);
  }

  getAvailableActions(status: AdminBulkJobStatus): AdminBulkJobAction[] {
    if (status === 'queued' || status === 'enumerating' || status === 'fanout') {
      return ['pause', 'cancel'];
    }
    if (status === 'paused') {
      return ['resume', 'cancel'];
    }
    return [];
  }

  private buildProgress(job: AdminBulkJobRecord): AdminBulkJobProgress {
    const completed = job.targetsCoalesced + job.targetsOutboxed + job.targetsDispatched + job.targetsFailed + job.targetsCanceled;
    const targetTotal = job.targetsTotal > 0 ? job.targetsTotal : job.targetCountEstimate;
    const percent = targetTotal && targetTotal > 0 ? Math.min(100, Math.round((completed / targetTotal) * 100)) : null;
    return {
      targetTotal,
      queued: job.targetsQueued,
      coalesced: job.targetsCoalesced,
      outboxed: job.targetsOutboxed,
      dispatched: job.targetsDispatched,
      failed: job.targetsFailed,
      canceled: job.targetsCanceled,
      completed,
      percent,
    };
  }

  private validateScope(scope: AdminBulkJobScope): AdminBulkJobScope {
    if (!scope || typeof scope !== 'object') {
      throw new HttpError(400, 'scope is required.');
    }
    if (scope.type === 'explicit_targets' || scope.type === 'all_users') {
      return scope;
    }
    if (scope.type === 'tier' && (scope.tier === 'free' || scope.tier === 'pro' || scope.tier === 'ultra')) {
      return scope;
    }
    throw new HttpError(400, 'Invalid bulk job scope.');
  }
}
