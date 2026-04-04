import type { DbClient } from '../../lib/db.js';
import { requireDbIsoString, toDbIsoString } from '../../lib/time.js';

export type RecommendationGenerationJobStatus = 'pending' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export type RecommendationGenerationJobRecord = {
  id: string;
  profileId: string;
  accountId: string;
  sourceKey: string;
  algorithmVersion: string;
  historyGeneration: number;
  idempotencyKey: string;
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
  lastSubmittedAt: string | null;
  lastPolledAt: string | null;
  nextPollAt: string | null;
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
  oldestNextPollAt: string | null;
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
    lastSubmittedAt: toDbIsoString(row.last_submitted_at as Date | string | null | undefined, 'recommendation_generation_jobs.last_submitted_at'),
    lastPolledAt: toDbIsoString(row.last_polled_at as Date | string | null | undefined, 'recommendation_generation_jobs.last_polled_at'),
    nextPollAt: toDbIsoString(row.next_poll_at as Date | string | null | undefined, 'recommendation_generation_jobs.next_poll_at'),
    createdAt: requireDbIsoString(row.created_at as Date | string | null | undefined, 'recommendation_generation_jobs.created_at'),
    updatedAt: requireDbIsoString(row.updated_at as Date | string | null | undefined, 'recommendation_generation_jobs.updated_at'),
  };
}

const JOB_SELECT = `
  SELECT id, profile_id, account_id, source_key, algorithm_version, history_generation,
         idempotency_key, worker_job_id, status, request_payload, last_status_payload,
         failure_json, submit_attempts, poll_attempts, poll_error_count, accepted_at,
         started_at, completed_at, cancelled_at, last_submitted_at, last_polled_at,
         next_poll_at, created_at, updated_at
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
    requestPayload: Record<string, unknown>;
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
          request_payload,
          status
        )
        VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::jsonb, $8)
        RETURNING id, profile_id, account_id, source_key, algorithm_version, history_generation,
                  idempotency_key, worker_job_id, status, request_payload, last_status_payload,
                  failure_json, submit_attempts, poll_attempts, poll_error_count, accepted_at,
                  started_at, completed_at, cancelled_at, last_submitted_at, last_polled_at,
                  next_poll_at, created_at, updated_at
      `,
      [
        params.profileId,
        params.accountId,
        params.sourceKey,
        params.algorithmVersion,
        params.historyGeneration,
        params.idempotencyKey,
        JSON.stringify(params.requestPayload),
        params.status ?? 'pending',
      ],
    );
    return mapJob(result.rows[0]);
  }

  async findById(client: DbClient, jobId: string): Promise<RecommendationGenerationJobRecord | null> {
    const result = await client.query(`${JOB_SELECT} WHERE id = $1::uuid`, [jobId]);
    return result.rows[0] ? mapJob(result.rows[0]) : null;
  }

  async findByIdempotencyKey(client: DbClient, idempotencyKey: string): Promise<RecommendationGenerationJobRecord | null> {
    const result = await client.query(`${JOB_SELECT} WHERE idempotency_key = $1`, [idempotencyKey]);
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

  async listForProfile(client: DbClient, profileId: string, limit = 20): Promise<RecommendationGenerationJobRecord[]> {
    const result = await client.query(
      `${JOB_SELECT} WHERE profile_id = $1::uuid ORDER BY created_at DESC LIMIT $2`,
      [profileId, limit],
    );
    return result.rows.map((row) => mapJob(row));
  }

  async listDueForPolling(client: DbClient, now: string, limit: number): Promise<RecommendationGenerationJobRecord[]> {
    const result = await client.query(
      `
        ${JOB_SELECT}
        WHERE status IN ('queued', 'running')
          AND next_poll_at IS NOT NULL
          AND next_poll_at <= $1::timestamptz
        ORDER BY next_poll_at ASC, updated_at ASC
        LIMIT $2
      `,
      [now, limit],
    );
    return result.rows.map((row) => mapJob(row));
  }

  async listRecoverable(client: DbClient, params: {
    now: string;
    stalePendingBefore: string;
    limit: number;
  }): Promise<RecommendationGenerationJobRecord[]> {
    const result = await client.query(
      `
        ${JOB_SELECT}
        WHERE (
          status = 'pending'
          AND (
            (next_poll_at IS NOT NULL AND next_poll_at <= $1::timestamptz)
            OR (next_poll_at IS NULL AND last_submitted_at IS NULL AND updated_at <= $2::timestamptz)
          )
        )
        OR (
          status IN ('queued', 'running')
          AND next_poll_at IS NOT NULL
          AND next_poll_at <= $1::timestamptz
        )
        ORDER BY COALESCE(next_poll_at, updated_at) ASC, updated_at ASC
        LIMIT $3
      `,
      [params.now, params.stalePendingBefore, params.limit],
    );
    return result.rows.map((row) => mapJob(row));
  }

  async listRecent(client: DbClient, limit: number): Promise<RecommendationGenerationJobRecord[]> {
    const result = await client.query(
      `${JOB_SELECT} ORDER BY updated_at DESC, created_at DESC LIMIT $1`,
      [limit],
    );
    return result.rows.map((row) => mapJob(row));
  }

  async markSubmitted(client: DbClient, jobId: string, params: {
    workerJobId: string;
    status: RecommendationGenerationJobStatus;
    acceptedAt?: string | null;
    nextPollAt?: string | null;
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
            next_poll_at = $5::timestamptz,
            last_status_payload = CASE WHEN $6::jsonb IS NULL THEN last_status_payload ELSE $6::jsonb END,
            failure_json = '{}'::jsonb,
            updated_at = now()
        WHERE id = $1::uuid
      `,
      [
        jobId,
        params.workerJobId,
        params.status,
        params.acceptedAt ?? null,
        params.nextPollAt ?? null,
        params.lastStatusPayload ? JSON.stringify(params.lastStatusPayload) : null,
      ],
    );
  }

  async markSubmitError(client: DbClient, jobId: string, params: {
    failureJson: Record<string, unknown>;
    nextPollAt?: string | null;
  }): Promise<void> {
    await client.query(
      `
        UPDATE recommendation_generation_jobs
        SET last_submitted_at = now(),
            submit_attempts = submit_attempts + 1,
            next_poll_at = COALESCE($2::timestamptz, next_poll_at),
            failure_json = $3::jsonb,
            updated_at = now()
        WHERE id = $1::uuid
      `,
      [jobId, params.nextPollAt ?? null, JSON.stringify(params.failureJson)],
    );
  }

  async markStatusPolled(client: DbClient, jobId: string, params: {
    status: RecommendationGenerationJobStatus;
    startedAt?: string | null;
    completedAt?: string | null;
    cancelledAt?: string | null;
    nextPollAt?: string | null;
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
            next_poll_at = $6::timestamptz,
            last_status_payload = CASE WHEN $7::jsonb IS NULL THEN last_status_payload ELSE $7::jsonb END,
            failure_json = CASE WHEN $8::jsonb IS NULL THEN failure_json ELSE $8::jsonb END,
            updated_at = now()
        WHERE id = $1::uuid
      `,
      [
        jobId,
        params.status,
        params.startedAt ?? null,
        params.completedAt ?? null,
        params.cancelledAt ?? null,
        params.nextPollAt ?? null,
        params.lastStatusPayload ? JSON.stringify(params.lastStatusPayload) : null,
        params.failureJson ? JSON.stringify(params.failureJson) : null,
      ],
    );
  }

  async markPollError(client: DbClient, jobId: string, params: {
    nextPollAt: string | null;
    failureJson: Record<string, unknown>;
  }): Promise<void> {
    await client.query(
      `
        UPDATE recommendation_generation_jobs
        SET last_polled_at = now(),
            poll_attempts = poll_attempts + 1,
            poll_error_count = poll_error_count + 1,
            next_poll_at = $2::timestamptz,
            failure_json = $3::jsonb,
            updated_at = now()
        WHERE id = $1::uuid
      `,
      [jobId, params.nextPollAt, JSON.stringify(params.failureJson)],
    );
  }

  async markTerminal(client: DbClient, jobId: string, params: {
    status: Extract<RecommendationGenerationJobStatus, 'failed' | 'cancelled' | 'succeeded'>;
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
            next_poll_at = NULL,
            last_status_payload = CASE WHEN $6::jsonb IS NULL THEN last_status_payload ELSE $6::jsonb END,
            failure_json = CASE WHEN $7::jsonb IS NULL THEN failure_json ELSE $7::jsonb END,
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
          MIN(next_poll_at) FILTER (WHERE status IN ('queued', 'running')) AS oldest_next_poll_at
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
      oldestNextPollAt: toDbIsoString(row.oldest_next_poll_at as Date | string | null | undefined, 'recommendation_generation_jobs.oldest_next_poll_at'),
    };
  }
}
