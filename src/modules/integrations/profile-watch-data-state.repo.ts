import type { DbClient } from '../../lib/db.js';
import { requireDbIsoString, toDbIsoString } from '../../lib/time.js';
import type { ProfileWatchDataOrigin, ProviderImportProvider } from './provider-import.types.js';

export type ProfileWatchDataStateRecord = {
  profileId: string;
  historyGeneration: number;
  currentOrigin: ProfileWatchDataOrigin;
  lastImportProvider: ProviderImportProvider | null;
  lastImportJobId: string | null;
  lastResetAt: string | null;
  lastImportCompletedAt: string | null;
  updatedAt: string;
};

function mapState(row: Record<string, unknown>): ProfileWatchDataStateRecord {
  return {
    profileId: String(row.profile_id),
    historyGeneration: Number(row.history_generation),
    currentOrigin: String(row.current_origin) as ProfileWatchDataOrigin,
    lastImportProvider: typeof row.last_import_provider === 'string' ? (row.last_import_provider as ProviderImportProvider) : null,
    lastImportJobId: typeof row.last_import_job_id === 'string' ? row.last_import_job_id : null,
    lastResetAt: toDbIsoString(row.last_reset_at as Date | string | null | undefined, 'profile_watch_data_state.last_reset_at'),
    lastImportCompletedAt: toDbIsoString(row.last_import_completed_at as Date | string | null | undefined, 'profile_watch_data_state.last_import_completed_at'),
    updatedAt: requireDbIsoString(row.updated_at as Date | string | null | undefined, 'profile_watch_data_state.updated_at'),
  };
}

export class ProfileWatchDataStateRepository {
  async ensure(client: DbClient, profileId: string): Promise<ProfileWatchDataStateRecord> {
    const result = await client.query(
      `
        INSERT INTO profile_watch_data_state (profile_id)
        VALUES ($1::uuid)
        ON CONFLICT (profile_id)
        DO UPDATE SET updated_at = profile_watch_data_state.updated_at
        RETURNING profile_id, history_generation, current_origin, last_import_provider,
                  last_import_job_id, last_reset_at, last_import_completed_at, updated_at
      `,
      [profileId],
    );
    return mapState(result.rows[0]);
  }

  async getForProfile(client: DbClient, profileId: string): Promise<ProfileWatchDataStateRecord | null> {
    const result = await client.query(
      `
        SELECT profile_id, history_generation, current_origin, last_import_provider,
               last_import_job_id, last_reset_at, last_import_completed_at, updated_at
        FROM profile_watch_data_state
        WHERE profile_id = $1::uuid
      `,
      [profileId],
    );
    return result.rows[0] ? mapState(result.rows[0]) : null;
  }

  async markResetForImport(client: DbClient, params: {
    profileId: string;
    provider: ProviderImportProvider;
    importJobId: string;
    resetAt: string;
  }): Promise<ProfileWatchDataStateRecord> {
    const result = await client.query(
      `
        INSERT INTO profile_watch_data_state (
          profile_id,
          history_generation,
          current_origin,
          last_import_provider,
          last_import_job_id,
          last_reset_at,
          updated_at
        )
        VALUES ($1::uuid, 1, $2, $3, $4::uuid, $5::timestamptz, now())
        ON CONFLICT (profile_id)
        DO UPDATE SET
          history_generation = profile_watch_data_state.history_generation + 1,
          current_origin = EXCLUDED.current_origin,
          last_import_provider = EXCLUDED.last_import_provider,
          last_import_job_id = EXCLUDED.last_import_job_id,
          last_reset_at = EXCLUDED.last_reset_at,
          updated_at = now()
        RETURNING profile_id, history_generation, current_origin, last_import_provider,
                  last_import_job_id, last_reset_at, last_import_completed_at, updated_at
      `,
      [params.profileId, 'provider_import', params.provider, params.importJobId, params.resetAt],
    );
    return mapState(result.rows[0]);
  }

  async markImportCompleted(client: DbClient, params: {
    profileId: string;
    provider: ProviderImportProvider;
    importJobId: string;
    completedAt: string;
  }): Promise<ProfileWatchDataStateRecord> {
    const result = await client.query(
      `
        UPDATE profile_watch_data_state
        SET current_origin = $2,
            last_import_provider = $3,
            last_import_job_id = $4::uuid,
            last_import_completed_at = $5::timestamptz,
            updated_at = now()
        WHERE profile_id = $1::uuid
        RETURNING profile_id, history_generation, current_origin, last_import_provider,
                  last_import_job_id, last_reset_at, last_import_completed_at, updated_at
      `,
      [params.profileId, 'provider_import', params.provider, params.importJobId, params.completedAt],
    );
    return mapState(result.rows[0]);
  }
}
