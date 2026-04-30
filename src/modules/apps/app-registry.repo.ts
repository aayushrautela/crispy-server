import type pg from 'pg';
import type { AppId, AppRateLimitPolicy, AppRegistryEntry, AppScope } from './app-principal.types.js';

type QueryableDb = Pick<pg.Pool | pg.PoolClient, 'query'>;

const DEFAULT_RATE_LIMIT_POLICY: AppRateLimitPolicy = {
  profileChangesReadsPerMinute: 60,
  profileSignalReadsPerMinute: 120,
  recommendationWritesPerMinute: 60,
  batchWritesPerMinute: 20,
  configBundleReadsPerMinute: 60,
  runsPerHour: 10,
  snapshotsPerDay: 5,
  maxProfilesPerBatch: 500,
  maxItemsPerList: 100,
};

export interface AppRegistryRepo {
  findAppById(appId: AppId): Promise<AppRegistryEntry | null>;
  listScopesForApp(appId: AppId): Promise<AppScope[]>;
  listOwnedSourcesForApp(appId: AppId): Promise<string[]>;
  listOwnedListKeysForApp(appId: AppId): Promise<string[]>;
  getRateLimitPolicy(appId: AppId): Promise<AppRateLimitPolicy>;
}

export class SqlAppRegistryRepo implements AppRegistryRepo {
  constructor(private readonly deps: { db: QueryableDb }) {}

  async findAppById(appId: AppId): Promise<AppRegistryEntry | null> {
    const result = await this.deps.db.query(
      `SELECT app_id, name, description, status, owner_team, allowed_environments,
              principal_type, created_at, updated_at, disabled_at
         FROM app_registry
        WHERE app_id = $1`,
      [appId],
    );
    const row = result.rows[0] as AppRegistryRow | undefined;
    return row ? mapRegistryRow(row) : null;
  }

  async listScopesForApp(appId: AppId): Promise<AppScope[]> {
    const result = await this.deps.db.query(
      `SELECT scope
         FROM app_scopes
        WHERE app_id = $1
          AND status = 'active'
        ORDER BY scope`,
      [appId],
    );
    return result.rows.map((row: { scope: AppScope }) => row.scope);
  }

  async listOwnedSourcesForApp(appId: AppId): Promise<string[]> {
    const result = await this.deps.db.query(
      `SELECT source
         FROM app_source_ownership
        WHERE app_id = $1
          AND status = 'active'
        ORDER BY source`,
      [appId],
    );
    return result.rows.map((row: { source: string }) => row.source);
  }

  async listOwnedListKeysForApp(appId: AppId): Promise<string[]> {
    const result = await this.deps.db.query(
      `SELECT DISTINCT jsonb_array_elements_text(allowed_list_keys) AS list_key
         FROM app_source_ownership
        WHERE app_id = $1
          AND status = 'active'
        ORDER BY list_key`,
      [appId],
    );
    return result.rows.map((row: { list_key: string }) => row.list_key);
  }

  async getRateLimitPolicy(appId: AppId): Promise<AppRateLimitPolicy> {
    const result = await this.deps.db.query(
      `SELECT profile_changes_reads_per_minute, profile_signal_reads_per_minute,
              recommendation_writes_per_minute, batch_writes_per_minute,
              config_bundle_reads_per_minute, runs_per_hour, snapshots_per_day,
              max_profiles_per_batch, max_items_per_list
         FROM app_rate_limit_policies
        WHERE app_id = $1`,
      [appId],
    );
    const row = result.rows[0] as AppRateLimitPolicyRow | undefined;
    return row ? mapRateLimitPolicyRow(row) : { ...DEFAULT_RATE_LIMIT_POLICY };
  }
}

interface AppRegistryRow {
  app_id: string;
  name: string;
  description: string | null;
  status: AppRegistryEntry['status'];
  owner_team: string;
  allowed_environments: string[];
  principal_type: AppRegistryEntry['principalType'];
  created_at: Date;
  updated_at: Date;
  disabled_at: Date | null;
}

interface AppRateLimitPolicyRow {
  profile_changes_reads_per_minute: number;
  profile_signal_reads_per_minute: number;
  recommendation_writes_per_minute: number;
  batch_writes_per_minute: number;
  config_bundle_reads_per_minute: number;
  runs_per_hour: number;
  snapshots_per_day: number;
  max_profiles_per_batch: number;
  max_items_per_list: number;
}

function mapRegistryRow(row: AppRegistryRow): AppRegistryEntry {
  return {
    appId: row.app_id,
    name: row.name,
    description: row.description ?? undefined,
    status: row.status,
    ownerTeam: row.owner_team,
    allowedEnvironments: row.allowed_environments,
    principalType: row.principal_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    disabledAt: row.disabled_at,
  };
}

function mapRateLimitPolicyRow(row: AppRateLimitPolicyRow): AppRateLimitPolicy {
  return {
    profileChangesReadsPerMinute: row.profile_changes_reads_per_minute,
    profileSignalReadsPerMinute: row.profile_signal_reads_per_minute,
    recommendationWritesPerMinute: row.recommendation_writes_per_minute,
    batchWritesPerMinute: row.batch_writes_per_minute,
    configBundleReadsPerMinute: row.config_bundle_reads_per_minute,
    runsPerHour: row.runs_per_hour,
    snapshotsPerDay: row.snapshots_per_day,
    maxProfilesPerBatch: row.max_profiles_per_batch,
    maxItemsPerList: row.max_items_per_list,
  };
}
