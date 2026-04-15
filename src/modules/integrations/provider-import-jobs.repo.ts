import type { DbClient } from '../../lib/db.js';
import { requireDbIsoString, toDbIsoString } from '../../lib/time.js';
import type { ProviderImportJobMode, ProviderImportJobStatus, ProviderImportProvider } from './provider-import.types.js';

export type ProviderImportJobRecord = {
  id: string;
  profileId: string;
  profileGroupId: string;
  provider: ProviderImportProvider;
  mode: ProviderImportJobMode;
  status: ProviderImportJobStatus;
  requestedByUserId: string;
  checkpointJson: Record<string, unknown>;
  summaryJson: Record<string, unknown>;
  errorJson: Record<string, unknown>;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
};

export type ProviderImportJobAdminRecord = ProviderImportJobRecord & {
  errorCode: string | null;
  errorMessage: string | null;
};

function mapJob(row: Record<string, unknown>): ProviderImportJobRecord {
  return {
    id: String(row.id),
    profileId: String(row.profile_id),
    profileGroupId: String(row.profile_group_id),
    provider: String(row.provider) as ProviderImportProvider,
    mode: String(row.mode) as ProviderImportJobMode,
    status: String(row.status) as ProviderImportJobStatus,
    requestedByUserId: String(row.requested_by_user_id),
    checkpointJson: (row.checkpoint_json as Record<string, unknown> | undefined) ?? {},
    summaryJson: (row.summary_json as Record<string, unknown> | undefined) ?? {},
    errorJson: (row.error_json as Record<string, unknown> | undefined) ?? {},
    createdAt: requireDbIsoString(row.created_at as Date | string | null | undefined, 'provider_import_jobs.created_at'),
    startedAt: toDbIsoString(row.started_at as Date | string | null | undefined, 'provider_import_jobs.started_at'),
    finishedAt: toDbIsoString(row.finished_at as Date | string | null | undefined, 'provider_import_jobs.finished_at'),
    updatedAt: requireDbIsoString(row.updated_at as Date | string | null | undefined, 'provider_import_jobs.updated_at'),
  };
}

export class ProviderImportJobsRepository {
  async create(client: DbClient, params: {
    profileId: string;
    profileGroupId: string;
    provider: ProviderImportProvider;
    requestedByUserId: string;
    status: ProviderImportJobStatus;
  }): Promise<ProviderImportJobRecord> {
    const result = await client.query(
      `
        INSERT INTO provider_import_jobs (
          profile_id,
          profile_group_id,
          provider,
          mode,
          status,
          requested_by_user_id
        )
        VALUES ($1::uuid, $2::uuid, $3, 'replace_import', $4, $5::uuid)
        RETURNING id, profile_id, profile_group_id, provider, mode, status, requested_by_user_id,
                  checkpoint_json, summary_json, error_json, created_at, started_at, finished_at, updated_at
      `,
      [params.profileId, params.profileGroupId, params.provider, params.status, params.requestedByUserId],
    );
    return mapJob(result.rows[0]);
  }

  async listForProfile(client: DbClient, profileId: string, limit = 20): Promise<ProviderImportJobRecord[]> {
    const result = await client.query(
      `
        SELECT id, profile_id, profile_group_id, provider, mode, status, requested_by_user_id,
               checkpoint_json, summary_json, error_json, created_at, started_at, finished_at, updated_at
        FROM provider_import_jobs
        WHERE profile_id = $1::uuid
        ORDER BY created_at DESC
        LIMIT $2
      `,
      [profileId, limit],
    );
    return result.rows.map((row) => mapJob(row));
  }

  async findByIdForProfile(client: DbClient, profileId: string, jobId: string): Promise<ProviderImportJobRecord | null> {
    const result = await client.query(
      `
        SELECT id, profile_id, profile_group_id, provider, mode, status, requested_by_user_id,
               checkpoint_json, summary_json, error_json, created_at, started_at, finished_at, updated_at
        FROM provider_import_jobs
        WHERE profile_id = $1::uuid AND id = $2::uuid
      `,
      [profileId, jobId],
    );
    return result.rows[0] ? mapJob(result.rows[0]) : null;
  }

  async findById(client: DbClient, jobId: string): Promise<ProviderImportJobRecord | null> {
    const result = await client.query(
      `
        SELECT id, profile_id, profile_group_id, provider, mode, status, requested_by_user_id,
               checkpoint_json, summary_json, error_json, created_at, started_at, finished_at, updated_at
        FROM provider_import_jobs
        WHERE id = $1::uuid
      `,
      [jobId],
    );
    return result.rows[0] ? mapJob(result.rows[0]) : null;
  }

  async findLatestOauthPendingForProfileProvider(
    client: DbClient,
    profileId: string,
    provider: ProviderImportProvider,
  ): Promise<ProviderImportJobRecord | null> {
    const result = await client.query(
      `
        SELECT id, profile_id, profile_group_id, provider, mode, status, requested_by_user_id,
               checkpoint_json, summary_json, error_json, created_at, started_at, finished_at, updated_at
        FROM provider_import_jobs
        WHERE profile_id = $1::uuid
          AND provider = $2
          AND status = 'oauth_pending'
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [profileId, provider],
    );
    return result.rows[0] ? mapJob(result.rows[0]) : null;
  }

  async markQueued(client: DbClient, jobId: string, params?: {
    summaryJson?: Record<string, unknown>;
    checkpointJson?: Record<string, unknown>;
  }): Promise<void> {
    await client.query(
      `
        UPDATE provider_import_jobs
        SET status = 'queued',
            summary_json = CASE WHEN $2::jsonb IS NULL THEN summary_json ELSE $2::jsonb END,
            checkpoint_json = CASE WHEN $3::jsonb IS NULL THEN checkpoint_json ELSE $3::jsonb END,
            error_json = '{}'::jsonb,
            finished_at = null,
            updated_at = now()
        WHERE id = $1::uuid
      `,
      [
        jobId,
        params?.summaryJson ? JSON.stringify(params.summaryJson) : null,
        params?.checkpointJson ? JSON.stringify(params.checkpointJson) : null,
      ],
    );
  }

  async markRunning(client: DbClient, jobId: string): Promise<void> {
    await client.query(
      `
        UPDATE provider_import_jobs
        SET status = 'running', started_at = COALESCE(started_at, now()), updated_at = now()
        WHERE id = $1::uuid
      `,
      [jobId],
    );
  }

  async markSucceeded(client: DbClient, jobId: string, params?: {
    summaryJson?: Record<string, unknown>;
    checkpointJson?: Record<string, unknown>;
  }): Promise<void> {
    await client.query(
      `
        UPDATE provider_import_jobs
        SET status = 'succeeded',
            summary_json = CASE WHEN $2::jsonb IS NULL THEN summary_json ELSE $2::jsonb END,
            checkpoint_json = CASE WHEN $3::jsonb IS NULL THEN checkpoint_json ELSE $3::jsonb END,
            error_json = '{}'::jsonb,
            finished_at = now(),
            updated_at = now()
        WHERE id = $1::uuid
      `,
      [
        jobId,
        params?.summaryJson ? JSON.stringify(params.summaryJson) : null,
        params?.checkpointJson ? JSON.stringify(params.checkpointJson) : null,
      ],
    );
  }

  async markSucceededWithWarnings(client: DbClient, jobId: string, params?: {
    summaryJson?: Record<string, unknown>;
    checkpointJson?: Record<string, unknown>;
  }): Promise<void> {
    await client.query(
      `
        UPDATE provider_import_jobs
        SET status = 'succeeded_with_warnings',
            summary_json = CASE WHEN $2::jsonb IS NULL THEN summary_json ELSE $2::jsonb END,
            checkpoint_json = CASE WHEN $3::jsonb IS NULL THEN checkpoint_json ELSE $3::jsonb END,
            error_json = '{}'::jsonb,
            finished_at = now(),
            updated_at = now()
        WHERE id = $1::uuid
      `,
      [
        jobId,
        params?.summaryJson ? JSON.stringify(params.summaryJson) : null,
        params?.checkpointJson ? JSON.stringify(params.checkpointJson) : null,
      ],
    );
  }

  async updateProgress(client: DbClient, jobId: string, params: {
    summaryJson?: Record<string, unknown>;
    checkpointJson?: Record<string, unknown>;
  }): Promise<void> {
    await client.query(
      `
        UPDATE provider_import_jobs
        SET summary_json = CASE WHEN $2::jsonb IS NULL THEN summary_json ELSE $2::jsonb END,
            checkpoint_json = CASE WHEN $3::jsonb IS NULL THEN checkpoint_json ELSE $3::jsonb END,
            updated_at = now()
        WHERE id = $1::uuid
      `,
      [
        jobId,
        params.summaryJson ? JSON.stringify(params.summaryJson) : null,
        params.checkpointJson ? JSON.stringify(params.checkpointJson) : null,
      ],
    );
  }

  async markFailed(client: DbClient, jobId: string, errorJson: Record<string, unknown>): Promise<void> {
    await client.query(
      `
        UPDATE provider_import_jobs
        SET status = 'failed', error_json = $2::jsonb, finished_at = now(), updated_at = now()
        WHERE id = $1::uuid
      `,
      [jobId, JSON.stringify(errorJson)],
    );
  }

  async listAdminJobs(client: DbClient, filters?: {
    provider?: ProviderImportProvider | null;
    status?: ProviderImportJobStatus | null;
    failuresOnly?: boolean;
    limit?: number;
  }): Promise<ProviderImportJobAdminRecord[]> {
    const result = await client.query(
      `
        SELECT id, profile_id, profile_group_id, provider, mode, status, requested_by_user_id,
               checkpoint_json, summary_json, error_json, created_at, started_at, finished_at, updated_at,
                NULLIF(error_json ->> 'code', '') AS error_code,
                NULLIF(error_json ->> 'message', '') AS error_message
        FROM provider_import_jobs
        WHERE ($1::text IS NULL OR provider = $1)
          AND ($2::text IS NULL OR status = $2)
          AND ($3::boolean = false OR status IN ('failed', 'succeeded_with_warnings'))
        ORDER BY created_at DESC
        LIMIT $4
      `,
      [
        filters?.provider ?? null,
        filters?.status ?? null,
        filters?.failuresOnly ?? false,
        filters?.limit ?? 100,
      ],
    );

    return result.rows.map((row) => ({
      ...mapJob(row),
      errorCode: typeof row.error_code === 'string' ? row.error_code : null,
      errorMessage: typeof row.error_message === 'string' ? row.error_message : null,
    }));
  }
}
