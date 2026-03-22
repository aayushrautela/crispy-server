import type { DbClient } from '../../lib/db.js';
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
    lastResetAt: typeof row.last_reset_at === 'string' ? row.last_reset_at : null,
    lastImportCompletedAt: typeof row.last_import_completed_at === 'string' ? row.last_import_completed_at : null,
    updatedAt: String(row.updated_at),
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
}
