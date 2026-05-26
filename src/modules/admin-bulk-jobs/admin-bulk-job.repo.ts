import { createHash, randomUUID } from 'node:crypto';
import type { DbClient } from '../../lib/db.js';
import { requireDbIsoString, toDbIsoString } from '../../lib/time.js';
import type {
  AdminBulkJobEventRecord,
  AdminBulkJobEventType,
  AdminBulkJobRecord,
  AdminBulkJobScope,
  AdminBulkJobStatus,
  AdminBulkJobTargetInput,
  AdminBulkJobTargetRecord,
} from './admin-bulk-job.types.js';

const jobColumns = `
  id,
  operation,
  scope_type,
  tier,
  status,
  requested_by_admin_id,
  request_correlation_id,
  dedupe_key,
  idempotency_key,
  reason,
  target_count_estimate,
  targets_total,
  targets_queued,
  targets_coalesced,
  targets_outboxed,
  targets_dispatched,
  targets_failed,
  targets_canceled,
  enumeration_cursor,
  fanout_cursor,
  pause_requested_at,
  resume_requested_at,
  cancel_requested_at,
  started_at,
  enumeration_completed_at,
  fanout_completed_at,
  completed_at,
  failed_at,
  last_error,
  created_at,
  updated_at
`;

const jobColumnsForJobsAlias = `
  jobs.id,
  jobs.operation,
  jobs.scope_type,
  jobs.tier,
  jobs.status,
  jobs.requested_by_admin_id,
  jobs.request_correlation_id,
  jobs.dedupe_key,
  jobs.idempotency_key,
  jobs.reason,
  jobs.target_count_estimate,
  jobs.targets_total,
  jobs.targets_queued,
  jobs.targets_coalesced,
  jobs.targets_outboxed,
  jobs.targets_dispatched,
  jobs.targets_failed,
  jobs.targets_canceled,
  jobs.enumeration_cursor,
  jobs.fanout_cursor,
  jobs.pause_requested_at,
  jobs.resume_requested_at,
  jobs.cancel_requested_at,
  jobs.started_at,
  jobs.enumeration_completed_at,
  jobs.fanout_completed_at,
  jobs.completed_at,
  jobs.failed_at,
  jobs.last_error,
  jobs.created_at,
  jobs.updated_at
`;

const targetColumns = `
  id,
  bulk_job_id,
  account_id,
  profile_id,
  target_key,
  status,
  idempotency_key,
  service_outbox_id,
  coalesced_with_outbox_id,
  attempt_count,
  last_error,
  created_at,
  updated_at,
  outboxed_at,
  terminal_at
`;

const eventColumns = `
  id,
  bulk_job_id,
  bulk_job_target_id,
  event_type,
  message,
  metadata,
  created_at
`;

export type EnumeratedProfileTarget = {
  accountId: string;
  profileId: string;
  cursor: string;
};

export type OutboxProgressCounts = {
  pending: number;
  processing: number;
  dispatched: number;
  failed: number;
  total: number;
};

export function buildAdminBulkJobDedupeKey(scope: AdminBulkJobScope, targets: AdminBulkJobTargetInput[], reason: string | null): string {
  const normalized = scope.type === 'explicit_targets'
    ? normalizeTargets(targets).map((target) => `${target.accountId}:${target.profileId}`)
    : [];
  return createHash('sha256')
    .update(JSON.stringify({ operation: 'recommendation_recompute', scope, targets: normalized, reason: reason ?? null }))
    .digest('hex');
}

export function buildAdminBulkJobRequestHash(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

export function normalizeTargets(targets: AdminBulkJobTargetInput[]): AdminBulkJobTargetInput[] {
  const seen = new Set<string>();
  const normalized: AdminBulkJobTargetInput[] = [];
  for (const target of targets) {
    const accountId = target.accountId.trim();
    const profileId = target.profileId.trim();
    const key = `${accountId}:${profileId}`;
    if (!accountId || !profileId || seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push({ accountId, profileId });
  }
  normalized.sort((a, b) => `${a.accountId}:${a.profileId}`.localeCompare(`${b.accountId}:${b.profileId}`));
  return normalized;
}

function mapJob(row: Record<string, unknown>): AdminBulkJobRecord {
  return {
    id: String(row.id),
    operation: 'recommendation_recompute',
    scopeType: String(row.scope_type) as AdminBulkJobRecord['scopeType'],
    tier: typeof row.tier === 'string' ? row.tier as AdminBulkJobRecord['tier'] : null,
    status: String(row.status) as AdminBulkJobStatus,
    requestedByAdminId: typeof row.requested_by_admin_id === 'string' ? row.requested_by_admin_id : null,
    requestCorrelationId: typeof row.request_correlation_id === 'string' ? row.request_correlation_id : null,
    dedupeKey: String(row.dedupe_key),
    idempotencyKey: typeof row.idempotency_key === 'string' ? row.idempotency_key : null,
    reason: typeof row.reason === 'string' ? row.reason : null,
    targetCountEstimate: typeof row.target_count_estimate === 'number' ? row.target_count_estimate : row.target_count_estimate == null ? null : Number(row.target_count_estimate),
    targetsTotal: Number(row.targets_total),
    targetsQueued: Number(row.targets_queued),
    targetsCoalesced: Number(row.targets_coalesced),
    targetsOutboxed: Number(row.targets_outboxed),
    targetsDispatched: Number(row.targets_dispatched),
    targetsFailed: Number(row.targets_failed),
    targetsCanceled: Number(row.targets_canceled),
    enumerationCursor: typeof row.enumeration_cursor === 'string' ? row.enumeration_cursor : null,
    fanoutCursor: typeof row.fanout_cursor === 'string' ? row.fanout_cursor : null,
    pauseRequestedAt: toDbIsoString(row.pause_requested_at as Date | string | null | undefined, 'admin_bulk_jobs.pause_requested_at'),
    resumeRequestedAt: toDbIsoString(row.resume_requested_at as Date | string | null | undefined, 'admin_bulk_jobs.resume_requested_at'),
    cancelRequestedAt: toDbIsoString(row.cancel_requested_at as Date | string | null | undefined, 'admin_bulk_jobs.cancel_requested_at'),
    startedAt: toDbIsoString(row.started_at as Date | string | null | undefined, 'admin_bulk_jobs.started_at'),
    enumerationCompletedAt: toDbIsoString(row.enumeration_completed_at as Date | string | null | undefined, 'admin_bulk_jobs.enumeration_completed_at'),
    fanoutCompletedAt: toDbIsoString(row.fanout_completed_at as Date | string | null | undefined, 'admin_bulk_jobs.fanout_completed_at'),
    completedAt: toDbIsoString(row.completed_at as Date | string | null | undefined, 'admin_bulk_jobs.completed_at'),
    failedAt: toDbIsoString(row.failed_at as Date | string | null | undefined, 'admin_bulk_jobs.failed_at'),
    lastError: row.last_error as Record<string, unknown> | null,
    createdAt: requireDbIsoString(row.created_at as Date | string | null | undefined, 'admin_bulk_jobs.created_at'),
    updatedAt: requireDbIsoString(row.updated_at as Date | string | null | undefined, 'admin_bulk_jobs.updated_at'),
  };
}

function mapTarget(row: Record<string, unknown>): AdminBulkJobTargetRecord {
  return {
    id: String(row.id),
    bulkJobId: String(row.bulk_job_id),
    accountId: String(row.account_id),
    profileId: String(row.profile_id),
    targetKey: String(row.target_key),
    status: String(row.status) as AdminBulkJobTargetRecord['status'],
    idempotencyKey: String(row.idempotency_key),
    serviceOutboxId: typeof row.service_outbox_id === 'string' ? row.service_outbox_id : null,
    coalescedWithOutboxId: typeof row.coalesced_with_outbox_id === 'string' ? row.coalesced_with_outbox_id : null,
    attemptCount: Number(row.attempt_count),
    lastError: row.last_error as Record<string, unknown> | null,
    createdAt: requireDbIsoString(row.created_at as Date | string | null | undefined, 'admin_bulk_job_targets.created_at'),
    updatedAt: requireDbIsoString(row.updated_at as Date | string | null | undefined, 'admin_bulk_job_targets.updated_at'),
    outboxedAt: toDbIsoString(row.outboxed_at as Date | string | null | undefined, 'admin_bulk_job_targets.outboxed_at'),
    terminalAt: toDbIsoString(row.terminal_at as Date | string | null | undefined, 'admin_bulk_job_targets.terminal_at'),
  };
}

function mapEvent(row: Record<string, unknown>): AdminBulkJobEventRecord {
  return {
    id: String(row.id),
    bulkJobId: String(row.bulk_job_id),
    bulkJobTargetId: typeof row.bulk_job_target_id === 'string' ? row.bulk_job_target_id : null,
    eventType: String(row.event_type) as AdminBulkJobEventType,
    message: typeof row.message === 'string' ? row.message : null,
    metadata: (row.metadata as Record<string, unknown> | undefined) ?? {},
    createdAt: requireDbIsoString(row.created_at as Date | string | null | undefined, 'admin_bulk_job_events.created_at'),
  };
}

function mapProfileTarget(row: Record<string, unknown>): EnumeratedProfileTarget {
  return {
    accountId: String(row.account_id),
    profileId: String(row.profile_id),
    cursor: `${String(row.account_id)}:${String(row.profile_id)}`,
  };
}

export class AdminBulkJobRepository {
  async findActiveByDedupeKey(client: DbClient, dedupeKey: string): Promise<AdminBulkJobRecord | null> {
    const result = await client.query(`SELECT ${jobColumns} FROM admin_bulk_jobs WHERE dedupe_key = $1 AND status IN ('queued', 'enumerating', 'fanout', 'paused') ORDER BY created_at DESC LIMIT 1`, [dedupeKey]);
    return result.rows[0] ? mapJob(result.rows[0]) : null;
  }

  async createJob(client: DbClient, input: { scope: AdminBulkJobScope; dedupeKey: string; idempotencyKey?: string | null; correlationId?: string | null; reason?: string | null; targetCountEstimate?: number | null; requestedByAdminId?: string | null }): Promise<AdminBulkJobRecord> {
    const result = await client.query(
      `INSERT INTO admin_bulk_jobs (operation, scope_type, tier, requested_by_admin_id, request_correlation_id, dedupe_key, idempotency_key, reason, target_count_estimate)
       VALUES ('recommendation_recompute', $1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${jobColumns}`,
      [input.scope.type, input.scope.type === 'tier' ? input.scope.tier : null, input.requestedByAdminId ?? null, input.correlationId ?? null, input.dedupeKey, input.idempotencyKey ?? null, input.reason ?? null, input.targetCountEstimate ?? null],
    );
    return mapJob(result.rows[0]);
  }

  async insertRequest(client: DbClient, input: { bulkJobId: string; idempotencyKey?: string | null; dedupeKey: string; requestHash: string; requestSnapshot: Record<string, unknown>; requestedByAdminId?: string | null }): Promise<void> {
    await client.query(
      `INSERT INTO admin_bulk_job_requests (bulk_job_id, idempotency_key, dedupe_key, request_hash, request_snapshot, requested_by_admin_id)
       VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6)
       ON CONFLICT DO NOTHING`,
      [input.bulkJobId, input.idempotencyKey ?? null, input.dedupeKey, input.requestHash, JSON.stringify(input.requestSnapshot), input.requestedByAdminId ?? null],
    );
  }

  async insertTargets(client: DbClient, bulkJobId: string, targets: AdminBulkJobTargetInput[], reason: string | null): Promise<AdminBulkJobTargetRecord[]> {
    const inserted: AdminBulkJobTargetRecord[] = [];
    for (const target of normalizeTargets(targets)) {
      const insertedTarget = await this.insertTarget(client, bulkJobId, target, reason);
      if (insertedTarget) {
        inserted.push(insertedTarget);
      }
    }
    if (inserted.length > 0) {
      await this.incrementTargetCounters(client, bulkJobId, inserted.length);
    }
    return inserted;
  }

  async insertTarget(client: DbClient, bulkJobId: string, target: AdminBulkJobTargetInput, reason: string | null): Promise<AdminBulkJobTargetRecord | null> {
    const normalized = normalizeTargets([target])[0];
    if (!normalized) {
      return null;
    }
    const targetKey = `${normalized.accountId}:${normalized.profileId}`;
    const idempotencyKey = createHash('sha256').update(JSON.stringify({ operation: 'recommendation_recompute', bulkJobId, targetKey, reason: reason ?? null })).digest('hex');
    const result = await client.query(
      `INSERT INTO admin_bulk_job_targets (bulk_job_id, account_id, profile_id, target_key, idempotency_key)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5)
       ON CONFLICT (bulk_job_id, target_key) DO NOTHING
       RETURNING ${targetColumns}`,
      [bulkJobId, normalized.accountId, normalized.profileId, targetKey, idempotencyKey],
    );
    return result.rows[0] ? mapTarget(result.rows[0]) : null;
  }

  async recordEvent(client: DbClient, input: { bulkJobId: string; bulkJobTargetId?: string | null; eventType: AdminBulkJobEventType; message?: string | null; metadata?: Record<string, unknown> }): Promise<AdminBulkJobEventRecord> {
    const result = await client.query(
      `INSERT INTO admin_bulk_job_events (id, bulk_job_id, bulk_job_target_id, event_type, message, metadata)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::jsonb)
       RETURNING ${eventColumns}`,
      [randomUUID(), input.bulkJobId, input.bulkJobTargetId ?? null, input.eventType, input.message ?? null, JSON.stringify(input.metadata ?? {})],
    );
    return mapEvent(result.rows[0]);
  }

  async listJobs(client: DbClient, filters: { status?: AdminBulkJobStatus | null; scope?: AdminBulkJobScope['type'] | null; limit: number }): Promise<AdminBulkJobRecord[]> {
    const params: unknown[] = [];
    const conditions: string[] = [];
    if (filters.status) {
      params.push(filters.status);
      conditions.push(`status = $${params.length}`);
    }
    if (filters.scope) {
      params.push(filters.scope);
      conditions.push(`scope_type = $${params.length}`);
    }
    params.push(filters.limit);
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await client.query(`SELECT ${jobColumns} FROM admin_bulk_jobs ${where} ORDER BY created_at DESC LIMIT $${params.length}`, params);
    return result.rows.map(mapJob);
  }

  async getJob(client: DbClient, jobId: string): Promise<AdminBulkJobRecord | null> {
    const result = await client.query(`SELECT ${jobColumns} FROM admin_bulk_jobs WHERE id = $1::uuid`, [jobId]);
    return result.rows[0] ? mapJob(result.rows[0]) : null;
  }

  async claimNextJob(client: DbClient, workerId: string, staleAfterSeconds: number): Promise<AdminBulkJobRecord | null> {
    const result = await client.query(
      `WITH next_job AS (
         SELECT id
         FROM admin_bulk_jobs
         WHERE status IN ('queued', 'enumerating', 'fanout', 'canceling')
            OR (status = 'paused' AND resume_requested_at IS NOT NULL AND (pause_requested_at IS NULL OR resume_requested_at >= pause_requested_at))
            OR (status IN ('enumerating', 'fanout') AND updated_at <= now() - ($2::text || ' seconds')::interval)
         ORDER BY created_at ASC, id ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       UPDATE admin_bulk_jobs jobs
       SET status = CASE
             WHEN jobs.cancel_requested_at IS NOT NULL OR jobs.status = 'canceling' THEN 'canceling'
             WHEN jobs.scope_type <> 'explicit_targets' AND jobs.enumeration_completed_at IS NULL THEN 'enumerating'
             ELSE 'fanout'
           END,
           started_at = COALESCE(jobs.started_at, now()),
           updated_at = now()
       FROM next_job
       WHERE jobs.id = next_job.id
       RETURNING ${jobColumnsForJobsAlias}`,
      [workerId, Math.max(30, staleAfterSeconds)],
    );
    return result.rows[0] ? mapJob(result.rows[0]) : null;
  }

  async listTargets(client: DbClient, jobId: string, limit: number): Promise<AdminBulkJobTargetRecord[]> {
    const result = await client.query(`SELECT ${targetColumns} FROM admin_bulk_job_targets WHERE bulk_job_id = $1::uuid ORDER BY created_at ASC LIMIT $2`, [jobId, limit]);
    return result.rows.map(mapTarget);
  }

  async listQueuedTargetsAfterCursor(client: DbClient, jobId: string, cursor: string | null, limit: number): Promise<AdminBulkJobTargetRecord[]> {
    const result = await client.query(
      `SELECT ${targetColumns}
       FROM admin_bulk_job_targets
       WHERE bulk_job_id = $1::uuid
         AND status = 'queued'
         AND ($2::text IS NULL OR target_key > $2::text)
       ORDER BY target_key ASC
       LIMIT $3
       FOR UPDATE SKIP LOCKED`,
      [jobId, cursor, limit],
    );
    return result.rows.map(mapTarget);
  }

  async listProfileTargetsPage(client: DbClient, input: { scope: AdminBulkJobScope; cursor: string | null; limit: number }): Promise<EnumeratedProfileTarget[]> {
    const limit = Math.max(1, Math.min(input.limit, 500));
    const cursorParts = input.cursor?.split(':') ?? [];
    const cursorAccountId = cursorParts.length === 2 ? cursorParts[0] : null;
    const cursorProfileId = cursorParts.length === 2 ? cursorParts[1] : null;
    const params: unknown[] = [cursorAccountId, cursorProfileId, limit];
    const tierClause = input.scope.type === 'tier' ? `AND COALESCE(account_preferences.settings_json->>'pricingTier', 'free') = $4` : '';
    if (input.scope.type === 'tier') {
      params.push(input.scope.tier);
    }
    const result = await client.query(
      `SELECT profiles.account_id::text AS account_id,
              profiles.id::text AS profile_id
       FROM identity.profiles profiles
       LEFT JOIN identity.account_preferences account_preferences ON account_preferences.account_id = profiles.account_id
       WHERE profiles.deleted_at IS NULL
         AND ($1::uuid IS NULL OR (profiles.account_id, profiles.id) > ($1::uuid, $2::uuid))
         ${tierClause}
       ORDER BY profiles.account_id ASC, profiles.id ASC
       LIMIT $3`,
      params,
    );
    return result.rows.map(mapProfileTarget);
  }

  async updateEnumerationCursor(client: DbClient, jobId: string, cursor: string | null): Promise<void> {
    await client.query(`UPDATE admin_bulk_jobs SET enumeration_cursor = $2, updated_at = now() WHERE id = $1::uuid`, [jobId, cursor]);
  }

  async markEnumerationCompleted(client: DbClient, jobId: string): Promise<void> {
    await client.query(`UPDATE admin_bulk_jobs SET status = 'fanout', enumeration_completed_at = COALESCE(enumeration_completed_at, now()), updated_at = now() WHERE id = $1::uuid`, [jobId]);
  }

  async updateFanoutCursor(client: DbClient, jobId: string, cursor: string | null): Promise<void> {
    await client.query(`UPDATE admin_bulk_jobs SET fanout_cursor = $2, updated_at = now() WHERE id = $1::uuid`, [jobId, cursor]);
  }

  async markTargetOutboxed(client: DbClient, input: { targetId: string; serviceOutboxId: string; cursor: string }): Promise<void> {
    await client.query(
      `UPDATE admin_bulk_job_targets
       SET status = 'outboxed',
           service_outbox_id = $2,
           outboxed_at = now(),
           terminal_at = now(),
           updated_at = now()
       WHERE id = $1::uuid AND status = 'queued'`,
      [input.targetId, input.serviceOutboxId],
    );
  }

  async markTargetCoalesced(client: DbClient, input: { targetId: string; serviceOutboxId: string }): Promise<void> {
    await client.query(
      `UPDATE admin_bulk_job_targets
       SET status = 'coalesced',
           coalesced_with_outbox_id = $2,
           terminal_at = now(),
           updated_at = now()
       WHERE id = $1::uuid AND status = 'queued'`,
      [input.targetId, input.serviceOutboxId],
    );
  }

  async markFanoutCompleted(client: DbClient, jobId: string): Promise<void> {
    await client.query(
      `UPDATE admin_bulk_jobs
       SET status = 'completed',
           fanout_completed_at = COALESCE(fanout_completed_at, now()),
           completed_at = COALESCE(completed_at, now()),
           updated_at = now()
       WHERE id = $1::uuid`,
      [jobId],
    );
  }

  async markPausedIfRequested(client: DbClient, jobId: string): Promise<boolean> {
    const result = await client.query(
      `UPDATE admin_bulk_jobs
       SET status = 'paused', updated_at = now()
       WHERE id = $1::uuid
         AND pause_requested_at IS NOT NULL
         AND (resume_requested_at IS NULL OR pause_requested_at > resume_requested_at)
         AND status IN ('queued', 'enumerating', 'fanout')
       RETURNING id`,
      [jobId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async cancelJob(client: DbClient, jobId: string): Promise<void> {
    const result = await client.query(
      `UPDATE admin_bulk_job_targets
       SET status = 'canceled', terminal_at = now(), updated_at = now()
       WHERE bulk_job_id = $1::uuid AND status = 'queued'`,
      [jobId],
    );
    const canceled = result.rowCount ?? 0;
    await client.query(
      `UPDATE admin_bulk_jobs
       SET status = 'canceled',
           targets_canceled = targets_canceled + $2,
           completed_at = COALESCE(completed_at, now()),
           updated_at = now()
       WHERE id = $1::uuid`,
      [jobId, canceled],
    );
  }

  async refreshCounters(client: DbClient, jobId: string): Promise<void> {
    await client.query(
      `WITH target_counts AS (
         SELECT bulk_job_id,
                count(*)::int AS total,
                count(*) FILTER (WHERE status = 'queued')::int AS queued,
                count(*) FILTER (WHERE status = 'coalesced')::int AS coalesced,
                count(*) FILTER (WHERE status = 'outboxed')::int AS outboxed,
                count(*) FILTER (WHERE status = 'canceled')::int AS canceled
         FROM admin_bulk_job_targets
         WHERE bulk_job_id = $1::uuid
         GROUP BY bulk_job_id
       ), outbox_counts AS (
         SELECT bulk_job_id,
                count(*) FILTER (WHERE status = 'dispatched')::int AS dispatched,
                count(*) FILTER (WHERE status = 'failed')::int AS failed
         FROM service_outbox_events
         WHERE bulk_job_id = $1::uuid
         GROUP BY bulk_job_id
       )
       UPDATE admin_bulk_jobs jobs
       SET targets_total = COALESCE(target_counts.total, 0),
           targets_queued = COALESCE(target_counts.queued, 0),
           targets_coalesced = COALESCE(target_counts.coalesced, 0),
           targets_outboxed = COALESCE(target_counts.outboxed, 0),
           targets_dispatched = COALESCE(outbox_counts.dispatched, 0),
           targets_failed = COALESCE(outbox_counts.failed, 0),
           targets_canceled = COALESCE(target_counts.canceled, 0),
           updated_at = now()
       FROM target_counts
       FULL JOIN outbox_counts ON outbox_counts.bulk_job_id = target_counts.bulk_job_id
       WHERE jobs.id = $1::uuid`,
      [jobId],
    );
  }

  async countLinkedOutboxEvents(client: DbClient, jobId: string): Promise<OutboxProgressCounts> {
    const result = await client.query(
      `SELECT count(*) FILTER (WHERE status = 'pending')::int AS pending,
              count(*) FILTER (WHERE status = 'processing')::int AS processing,
              count(*) FILTER (WHERE status = 'dispatched')::int AS dispatched,
              count(*) FILTER (WHERE status = 'failed')::int AS failed,
              count(*)::int AS total
       FROM service_outbox_events
       WHERE bulk_job_id = $1::uuid`,
      [jobId],
    );
    const row = result.rows[0] ?? {};
    return {
      pending: Number(row.pending ?? 0),
      processing: Number(row.processing ?? 0),
      dispatched: Number(row.dispatched ?? 0),
      failed: Number(row.failed ?? 0),
      total: Number(row.total ?? 0),
    };
  }

  async listEvents(client: DbClient, jobId: string, limit: number): Promise<AdminBulkJobEventRecord[]> {
    const result = await client.query(`SELECT ${eventColumns} FROM admin_bulk_job_events WHERE bulk_job_id = $1::uuid ORDER BY created_at DESC LIMIT $2`, [jobId, limit]);
    return result.rows.map(mapEvent);
  }

  async transitionJob(client: DbClient, jobId: string, action: 'pause' | 'resume' | 'cancel'): Promise<AdminBulkJobRecord | null> {
    const next = action === 'pause' ? 'paused' : action === 'resume' ? 'queued' : 'canceling';
    const allowed = action === 'pause' ? ['queued', 'enumerating', 'fanout', 'paused'] : action === 'resume' ? ['paused', 'queued'] : ['queued', 'enumerating', 'fanout', 'paused', 'canceling', 'canceled'];
    const stamp = action === 'pause' ? 'pause_requested_at' : action === 'resume' ? 'resume_requested_at' : 'cancel_requested_at';
    const result = await client.query(
      `UPDATE admin_bulk_jobs SET status = $2, ${stamp} = now(), updated_at = now() WHERE id = $1::uuid AND status = ANY($3::text[]) RETURNING ${jobColumns}`,
      [jobId, next, allowed],
    );
    return result.rows[0] ? mapJob(result.rows[0]) : null;
  }

  private async incrementTargetCounters(client: DbClient, bulkJobId: string, count: number): Promise<void> {
    await client.query(
      `UPDATE admin_bulk_jobs
       SET targets_total = targets_total + $2,
           targets_queued = targets_queued + $2,
           updated_at = now()
       WHERE id = $1::uuid`,
      [bulkJobId, count],
    );
  }
}
