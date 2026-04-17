import type { DbClient } from '../../lib/db.js';
import { requireDbIsoString, toDbIsoString } from '../../lib/time.js';

export type RecommendationGenerationJobStatus = 'pending' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

type RecommendationGenerationActiveJobStatus = Extract<RecommendationGenerationJobStatus, 'pending' | 'queued' | 'running'>;
type RecommendationGenerationRunnableJobStatus = Extract<RecommendationGenerationJobStatus, 'queued' | 'running'>;
type RecommendationGenerationTerminalJobStatus = Extract<RecommendationGenerationJobStatus, 'succeeded' | 'failed' | 'cancelled'>;

export type RecommendationGenerationTriggerSource = 'system' | 'admin_manual' | 'watch_event' | 'heartbeat_flush' | 'provider_import';

export type RecommendationGenerationJobRecord = {
  id: string;
  profileId: string;
  accountId: string;
  sourceKey: string;
  algorithmVersion: string;
  historyGeneration: number;
  idempotencyKey: string;
  triggerSource: RecommendationGenerationTriggerSource;
  workerJobId: string | null;
  status: RecommendationGenerationJobStatus;
  requestPayload: Record<string, unknown>;
  lastStatusPayload: Record<string, unknown>;
  failureJson: Record<string, unknown>;
  submitAttempts: number;
  pollAttempts: number;
  pollErrorCount: number;
  acceptedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  lastRequestedAt: string;
  lastSubmittedAt: string | null;
  lastPolledAt: string | null;
  nextRunAt: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RecommendationGenerationJobLagSummary = {
  pendingCount: number;
  queuedCount: number;
  runningCount: number;
  failedCount: number;
  submitFailureCount: number;
  pollFailureCount: number;
  oldestPendingCreatedAt: string | null;
  oldestNextRunAt: string | null;
};

function mapJob(row: Record<string, unknown>): RecommendationGenerationJobRecord {
  return {
    id: String(row.id),
    profileId: String(row.profile_id),
    accountId: String(row.account_id),
    sourceKey: String(row.source_key),
    algorithmVersion: String(row.algorithm_version),
    historyGeneration: Number(row.history_generation),
    idempotencyKey: String(row.idempotency_key),
    triggerSource: String(row.trigger_source ?? 'system') as RecommendationGenerationTriggerSource,
    workerJobId: typeof row.worker_job_id === 'string' ? row.worker_job_id : null,
    status: String(row.status) as RecommendationGenerationJobStatus,
    requestPayload: (row.request_payload as Record<string, unknown> | undefined) ?? {},
    lastStatusPayload: (row.last_status_payload as Record<string, unknown> | undefined) ?? {},
    failureJson: (row.failure_json as Record<string, unknown> | undefined) ?? {},
    submitAttempts: Number(row.submit_attempts ?? 0),
    pollAttempts: Number(row.poll_attempts ?? 0),
    pollErrorCount: Number(row.poll_error_count ?? 0),
    acceptedAt: toDbIsoString(row.accepted_at as Date | string | null | undefined, 'recommendation_generation_jobs.accepted_at'),
    startedAt: toDbIsoString(row.started_at as Date | string | null | undefined, 'recommendation_generation_jobs.started_at'),
    completedAt: toDbIsoString(row.completed_at as Date | string | null | undefined, 'recommendation_generation_jobs.completed_at'),
    cancelledAt: toDbIsoString(row.cancelled_at as Date | string | null | undefined, 'recommendation_generation_jobs.cancelled_at'),
    lastRequestedAt: requireDbIsoString(row.last_requested_at as Date | string | null | undefined, 'recommendation_generation_jobs.last_requested_at'),
    lastSubmittedAt: toDbIsoString(row.last_submitted_at as Date | string | null | undefined, 'recommendation_generation_jobs.last_submitted_at'),
    lastPolledAt: toDbIsoString(row.last_polled_at as Date | string | null | undefined, 'recommendation_generation_jobs.last_polled_at'),
    nextRunAt: toDbIsoString(row.next_run_at as Date | string | null | undefined, 'recommendation_generation_jobs.next_run_at'),
    leaseOwner: typeof row.lease_owner === 'string' ? row.lease_owner : null,
    leaseExpiresAt: toDbIsoString(row.lease_expires_at as Date | string | null | undefined, 'recommendation_generation_jobs.lease_expires_at'),
    createdAt: requireDbIsoString(row.created_at as Date | string | null | undefined, 'recommendation_generation_jobs.created_at'),
    updatedAt: requireDbIsoString(row.updated_at as Date | string | null | undefined, 'recommendation_generation_jobs.updated_at'),
  };
}

const JOB_SELECT = `
  SELECT id, profile_id, account_id, source_key, algorithm_version, history_generation,
         idempotency_key, trigger_source, worker_job_id, status, request_payload, last_status_payload,
         failure_json, submit_attempts, poll_attempts, poll_error_count, accepted_at,
         started_at, completed_at, cancelled_at, last_requested_at, last_submitted_at, last_polled_at,
         next_run_at, lease_owner, lease_expires_at, created_at, updated_at
  FROM recommendation_generation_jobs
`;

export class RecommendationGenerationJobsRepository {
  async create(client: DbClient, params: {
    profileId: string;
    accountId: string;
    sourceKey: string;
    algorithmVersion: string;
    historyGeneration: number;
    idempotencyKey: string;
    triggerSource: RecommendationGenerationTriggerSource;
    requestPayload: Record<string, unknown>;
    nextRunAt?: string;
    status?: RecommendationGenerationJobStatus;
  }): Promise<RecommendationGenerationJobRecord> {
    const result = await client.query(
      `
        INSERT INTO recommendation_generation_jobs (
          profile_id,
          account_id,
          source_key,
          algorithm_version,
          history_generation,
          idempotency_key,
          trigger_source,
          request_payload,
          next_run_at,
          status
        )
        VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8::jsonb, $9::timestamptz, $10)
        RETURNING id, profile_id, account_id, source_key, algorithm_version, history_generation,
                  idempotency_key, trigger_source, worker_job_id, status, request_payload, last_status_payload,
                  failure_json, submit_attempts, poll_attempts, poll_error_count, accepted_at,
                  started_at, completed_at, cancelled_at, last_requested_at, last_submitted_at, last_polled_at,
                  next_run_at, lease_owner, lease_expires_at, created_at, updated_at
      `,
      [
        params.profileId,
        params.accountId,
        params.sourceKey,
        params.algorithmVersion,
        params.historyGeneration,
        params.idempotencyKey,
        params.triggerSource,
        JSON.stringify(params.requestPayload),
        params.nextRunAt ?? new Date().toISOString(),
        params.status ?? 'pending',
      ],
    );
    return mapJob(result.rows[0]);
  }

  async findById(client: DbClient, jobId: string): Promise<RecommendationGenerationJobRecord | null> {
    const result = await client.query(`${JOB_SELECT} WHERE id = $1::uuid`, [jobId]);
    return result.rows[0] ? mapJob(result.rows[0]) : null;
  }

  async findByGenerationKey(client: DbClient, params: {
    profileId: string;
    sourceKey: string;
    algorithmVersion: string;
    historyGeneration: number;
  }): Promise<RecommendationGenerationJobRecord | null> {
    const result = await client.query(
      `${JOB_SELECT} WHERE profile_id = $1::uuid AND source_key = $2 AND algorithm_version = $3 AND history_generation = $4`,
      [params.profileId, params.sourceKey, params.algorithmVersion, params.historyGeneration],
    );
    return result.rows[0] ? mapJob(result.rows[0]) : null;
  }

  async listRecent(client: DbClient, limit: number): Promise<RecommendationGenerationJobRecord[]> {
    const result = await client.query(
      `${JOB_SELECT} ORDER BY updated_at DESC, created_at DESC LIMIT $1`,
      [limit],
    );
    return result.rows.map((row) => mapJob(row));
  }

  async clearBlockedForRetest(client: DbClient): Promise<{ deletedCount: number }> {
    const result = await client.query<{ deleted_count: string }>(
      `
        WITH deleted AS (
          DELETE FROM recommendation_generation_jobs
          WHERE status IN ('pending', 'failed', 'cancelled')
             OR (status = 'queued' AND worker_job_id IS NULL)
          RETURNING 1
        )
        SELECT COUNT(*)::text AS deleted_count
        FROM deleted
      `,
    );

    return {
      deletedCount: Number(result.rows[0]?.deleted_count ?? '0'),
    };
  }

  async markRequested(client: DbClient, jobId: string, params: {
    triggerSource: RecommendationGenerationTriggerSource;
    requestPayload: Record<string, unknown>;
    nextRunAt: string;
  }): Promise<void> {
    await client.query(
      `
        UPDATE recommendation_generation_jobs
        SET trigger_source = $2,
            request_payload = $3::jsonb,
            last_requested_at = now(),
            next_run_at = CASE
              WHEN next_run_at IS NULL THEN $4::timestamptz
              ELSE LEAST(next_run_at, $4::timestamptz)
            END,
            updated_at = now()
        WHERE id = $1::uuid
      `,
      [jobId, params.triggerSource, JSON.stringify(params.requestPayload), params.nextRunAt],
    );
  }

  async cancelSuperseded(client: DbClient, params: {
    profileId: string;
    sourceKey: string;
    algorithmVersion: string;
    historyGeneration: number;
  }): Promise<void> {
    await client.query(
      `
        UPDATE recommendation_generation_jobs
        SET status = 'cancelled',
            cancelled_at = COALESCE(cancelled_at, now()),
            next_run_at = NULL,
            lease_owner = NULL,
            lease_expires_at = NULL,
            failure_json = jsonb_build_object(
              'code', 'superseded',
              'message', 'Superseded by a newer recommendation generation request.'
            ),
            updated_at = now()
        WHERE profile_id = $1::uuid
          AND source_key = $2
          AND algorithm_version = $3
          AND history_generation < $4
          AND status IN ('pending', 'queued', 'running')
      `,
      [params.profileId, params.sourceKey, params.algorithmVersion, params.historyGeneration],
    );
  }

  async claimDueJobs(client: DbClient, params: {
    now: string;
    leaseOwner: string;
    leaseSeconds: number;
    limit: number;
  }): Promise<RecommendationGenerationJobRecord[]> {
    const result = await client.query(
      `
        WITH candidates AS (
          SELECT id
          FROM recommendation_generation_jobs
          WHERE status IN ('pending', 'queued', 'running')
            AND next_run_at <= $1::timestamptz
            AND (lease_expires_at IS NULL OR lease_expires_at <= $1::timestamptz)
          ORDER BY next_run_at ASC, updated_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT $4
        )
        UPDATE recommendation_generation_jobs job
        SET lease_owner = $2,
            lease_expires_at = now() + ($3 * interval '1 second'),
            updated_at = now()
        FROM candidates
        WHERE job.id = candidates.id
        RETURNING job.id, job.profile_id, job.account_id, job.source_key, job.algorithm_version, job.history_generation,
                  job.idempotency_key, job.trigger_source, job.worker_job_id, job.status, job.request_payload,
                  job.last_status_payload, job.failure_json, job.submit_attempts, job.poll_attempts,
                  job.poll_error_count, job.accepted_at, job.started_at, job.completed_at, job.cancelled_at,
                  job.last_requested_at, job.last_submitted_at, job.last_polled_at, job.next_run_at,
                  job.lease_owner, job.lease_expires_at, job.created_at, job.updated_at
      `,
      [params.now, params.leaseOwner, params.leaseSeconds, params.limit],
    );
    return result.rows.map((row) => mapJob(row));
  }

  async claimById(client: DbClient, params: {
    jobId: string;
    now: string;
    leaseOwner: string;
    leaseSeconds: number;
  }): Promise<RecommendationGenerationJobRecord | null> {
    const result = await client.query(
      `
        UPDATE recommendation_generation_jobs
        SET lease_owner = $2,
            lease_expires_at = now() + ($3 * interval '1 second'),
            updated_at = now()
        WHERE id = $1::uuid
          AND status IN ('pending', 'queued', 'running')
          AND (lease_expires_at IS NULL OR lease_expires_at <= $4::timestamptz)
        RETURNING id, profile_id, account_id, source_key, algorithm_version, history_generation,
                  idempotency_key, trigger_source, worker_job_id, status, request_payload,
                  last_status_payload, failure_json, submit_attempts, poll_attempts,
                  poll_error_count, accepted_at, started_at, completed_at, cancelled_at,
                  last_requested_at, last_submitted_at, last_polled_at, next_run_at,
                  lease_owner, lease_expires_at, created_at, updated_at
      `,
      [params.jobId, params.leaseOwner, params.leaseSeconds, params.now],
    );
    return result.rows[0] ? mapJob(result.rows[0]) : null;
  }

  async markSubmitted(client: DbClient, jobId: string, params: {
    workerJobId: string;
    status: RecommendationGenerationRunnableJobStatus | RecommendationGenerationTerminalJobStatus;
    acceptedAt?: string | null;
    nextRunAt: string | null;
    lastStatusPayload?: Record<string, unknown>;
  }): Promise<void> {
    await client.query(
      `
        UPDATE recommendation_generation_jobs
        SET worker_job_id = $2,
            status = $3,
            accepted_at = COALESCE($4::timestamptz, accepted_at),
            last_submitted_at = now(),
            submit_attempts = submit_attempts + 1,
            next_run_at = $5::timestamptz,
            last_status_payload = CASE WHEN $6::jsonb IS NULL THEN last_status_payload ELSE $6::jsonb END,
            failure_json = '{}'::jsonb,
            lease_owner = NULL,
            lease_expires_at = NULL,
            updated_at = now()
        WHERE id = $1::uuid
      `,
      [
        jobId,
        params.workerJobId,
        params.status,
        params.acceptedAt ?? null,
        params.nextRunAt ?? null,
        params.lastStatusPayload ? JSON.stringify(params.lastStatusPayload) : null,
      ],
    );
  }

  async markSubmitError(client: DbClient, jobId: string, params: {
    failureJson: Record<string, unknown>;
    nextRunAt?: string | null;
  }): Promise<void> {
    await client.query(
      `
        UPDATE recommendation_generation_jobs
        SET status = 'pending',
            last_submitted_at = now(),
            submit_attempts = submit_attempts + 1,
            next_run_at = COALESCE($2::timestamptz, next_run_at),
            failure_json = $3::jsonb,
            lease_owner = NULL,
            lease_expires_at = NULL,
            updated_at = now()
        WHERE id = $1::uuid
      `,
      [jobId, params.nextRunAt ?? null, JSON.stringify(params.failureJson)],
    );
  }

  async markStatusPolled(client: DbClient, jobId: string, params: {
    status: RecommendationGenerationRunnableJobStatus;
    startedAt?: string | null;
    completedAt?: string | null;
    cancelledAt?: string | null;
    nextRunAt: string;
    lastStatusPayload?: Record<string, unknown>;
    failureJson?: Record<string, unknown>;
  }): Promise<void> {
    await client.query(
      `
        UPDATE recommendation_generation_jobs
        SET status = $2,
            started_at = COALESCE($3::timestamptz, started_at),
            completed_at = COALESCE($4::timestamptz, completed_at),
            cancelled_at = COALESCE($5::timestamptz, cancelled_at),
            last_polled_at = now(),
            poll_attempts = poll_attempts + 1,
            next_run_at = $6::timestamptz,
            last_status_payload = CASE WHEN $7::jsonb IS NULL THEN last_status_payload ELSE $7::jsonb END,
            failure_json = CASE WHEN $8::jsonb IS NULL THEN failure_json ELSE $8::jsonb END,
            lease_owner = NULL,
            lease_expires_at = NULL,
            updated_at = now()
        WHERE id = $1::uuid
      `,
      [
        jobId,
        params.status,
        params.startedAt ?? null,
        params.completedAt ?? null,
        params.cancelledAt ?? null,
        params.nextRunAt ?? null,
        params.lastStatusPayload ? JSON.stringify(params.lastStatusPayload) : null,
        params.failureJson ? JSON.stringify(params.failureJson) : null,
      ],
    );
  }

  async markPollError(client: DbClient, jobId: string, params: {
    nextRunAt: string;
    failureJson: Record<string, unknown>;
  }): Promise<void> {
    await client.query(
      `
        UPDATE recommendation_generation_jobs
        SET last_polled_at = now(),
            poll_attempts = poll_attempts + 1,
            poll_error_count = poll_error_count + 1,
            next_run_at = $2::timestamptz,
            failure_json = $3::jsonb,
            lease_owner = NULL,
            lease_expires_at = NULL,
            updated_at = now()
        WHERE id = $1::uuid
      `,
      [jobId, params.nextRunAt, JSON.stringify(params.failureJson)],
    );
  }

  async markTerminal(client: DbClient, jobId: string, params: {
    status: RecommendationGenerationTerminalJobStatus;
    completedAt?: string | null;
    cancelledAt?: string | null;
    startedAt?: string | null;
    lastStatusPayload?: Record<string, unknown>;
    failureJson?: Record<string, unknown>;
  }): Promise<void> {
    await client.query(
      `
        UPDATE recommendation_generation_jobs
        SET status = $2,
            started_at = COALESCE($3::timestamptz, started_at),
            completed_at = COALESCE($4::timestamptz, completed_at),
            cancelled_at = COALESCE($5::timestamptz, cancelled_at),
            next_run_at = NULL,
            last_status_payload = CASE WHEN $6::jsonb IS NULL THEN last_status_payload ELSE $6::jsonb END,
            failure_json = CASE WHEN $7::jsonb IS NULL THEN failure_json ELSE $7::jsonb END,
            lease_owner = NULL,
            lease_expires_at = NULL,
            updated_at = now()
        WHERE id = $1::uuid
      `,
      [
        jobId,
        params.status,
        params.startedAt ?? null,
        params.completedAt ?? null,
        params.cancelledAt ?? null,
        params.lastStatusPayload ? JSON.stringify(params.lastStatusPayload) : null,
        params.failureJson ? JSON.stringify(params.failureJson) : null,
      ],
    );
  }

  async getLagSummary(client: DbClient): Promise<RecommendationGenerationJobLagSummary> {
    const result = await client.query(
      `
        SELECT
          COUNT(*) FILTER (WHERE status = 'pending')::integer AS pending_count,
          COUNT(*) FILTER (WHERE status = 'queued')::integer AS queued_count,
          COUNT(*) FILTER (WHERE status = 'running')::integer AS running_count,
          COUNT(*) FILTER (WHERE status = 'failed')::integer AS failed_count,
          COUNT(*) FILTER (WHERE submit_attempts > 0 AND worker_job_id IS NULL AND status = 'pending')::integer AS submit_failure_count,
          COUNT(*) FILTER (WHERE poll_error_count > 0)::integer AS poll_failure_count,
          MIN(created_at) FILTER (WHERE status = 'pending') AS oldest_pending_created_at,
          MIN(next_run_at) FILTER (WHERE status IN ('pending', 'queued', 'running')) AS oldest_next_run_at
        FROM recommendation_generation_jobs
      `,
    );
    const row = result.rows[0] ?? {};
    return {
      pendingCount: Number(row.pending_count ?? 0),
      queuedCount: Number(row.queued_count ?? 0),
      runningCount: Number(row.running_count ?? 0),
      failedCount: Number(row.failed_count ?? 0),
      submitFailureCount: Number(row.submit_failure_count ?? 0),
      pollFailureCount: Number(row.poll_failure_count ?? 0),
      oldestPendingCreatedAt: toDbIsoString(row.oldest_pending_created_at as Date | string | null | undefined, 'recommendation_generation_jobs.oldest_pending_created_at'),
      oldestNextRunAt: toDbIsoString(row.oldest_next_run_at as Date | string | null | undefined, 'recommendation_generation_jobs.oldest_next_run_at'),
    };
  }
}
