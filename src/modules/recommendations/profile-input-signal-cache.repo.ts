import type pg from 'pg';
import type {
  ProfileInputSignalCacheInvalidationReason,
  ProfileInputSignalCacheSection,
  ProfileInputSignalCacheWriteSection,
  ProfileInputSignalFamily,
  ProfileInputSignalCacheGenerationReason,
} from './profile-input-signal-cache.types.js';

export interface ProfileInputSignalCacheRepo {
  getSections(input: {
    accountId: string;
    profileId: string;
    families: ProfileInputSignalFamily[];
    schemaVersion: number;
  }): Promise<ProfileInputSignalCacheSection[]>;

  upsertSections(input: {
    accountId: string;
    profileId: string;
    schemaVersion: number;
    sections: ProfileInputSignalCacheWriteSection[];
    generationReason: ProfileInputSignalCacheGenerationReason;
  }): Promise<void>;

  invalidate(input: {
    accountId: string;
    profileId: string;
    families?: ProfileInputSignalFamily[];
    reason: ProfileInputSignalCacheInvalidationReason;
  }): Promise<void>;
}

type QueryableDb = Pick<pg.Pool | pg.PoolClient, 'query'>;

type ProfileInputSignalCacheRow = {
  account_id: string;
  profile_id: string;
  signal_family: ProfileInputSignalFamily;
  schema_version: number;
  payload_json: unknown;
  item_count: number;
  limit_coverage: number;
  materialized_at: Date;
  expires_at: Date | null;
  source_version: number | null;
  source_latest_updated_at: Date | null;
  is_complete: boolean;
  empty_kind: 'known_empty' | 'not_empty' | 'unknown';
  generation_reason: ProfileInputSignalCacheGenerationReason;
  invalidated_at: Date | null;
  invalidation_reason: ProfileInputSignalCacheInvalidationReason | null;
};

export class SqlProfileInputSignalCacheRepo implements ProfileInputSignalCacheRepo {
  constructor(private readonly deps: { db: QueryableDb }) {}

  async getSections(input: {
    accountId: string;
    profileId: string;
    families: ProfileInputSignalFamily[];
    schemaVersion: number;
  }): Promise<ProfileInputSignalCacheSection[]> {
    if (input.families.length === 0) return [];

    const result = await this.deps.db.query(
      `SELECT
        account_id,
        profile_id,
        signal_family,
        schema_version,
        payload_json,
        item_count,
        limit_coverage,
        materialized_at,
        expires_at,
        source_version,
        source_latest_updated_at,
        is_complete,
        empty_kind,
        generation_reason,
        invalidated_at,
        invalidation_reason
      FROM profile_input_signal_cache_sections
      WHERE account_id = $1
        AND profile_id = $2
        AND schema_version = $3
        AND signal_family = ANY($4)`,
      [input.accountId, input.profileId, input.schemaVersion, input.families],
    );

    return (result.rows as ProfileInputSignalCacheRow[]).map((row) => ({
      accountId: row.account_id,
      profileId: row.profile_id,
      family: row.signal_family,
      schemaVersion: row.schema_version,
      payload: row.payload_json,
      itemCount: row.item_count,
      limitCoverage: row.limit_coverage,
      materializedAt: new Date(row.materialized_at),
      ...(row.expires_at ? { expiresAt: new Date(row.expires_at) } : {}),
      ...(row.source_version !== null ? { sourceVersion: row.source_version } : {}),
      ...(row.source_latest_updated_at ? { sourceLatestUpdatedAt: new Date(row.source_latest_updated_at) } : {}),
      isComplete: row.is_complete,
      emptyKind: row.empty_kind,
      generationReason: row.generation_reason,
      ...(row.invalidated_at ? { invalidatedAt: new Date(row.invalidated_at) } : {}),
      ...(row.invalidation_reason ? { invalidationReason: row.invalidation_reason } : {}),
    }));
  }

  async upsertSections(input: {
    accountId: string;
    profileId: string;
    schemaVersion: number;
    sections: ProfileInputSignalCacheWriteSection[];
    generationReason: ProfileInputSignalCacheGenerationReason;
  }): Promise<void> {
    for (const section of input.sections) {
      await this.deps.db.query(
        `INSERT INTO profile_input_signal_cache_sections (
          account_id,
          profile_id,
          signal_family,
          schema_version,
          payload_json,
          item_count,
          limit_coverage,
          materialized_at,
          expires_at,
          source_version,
          source_latest_updated_at,
          is_complete,
          empty_kind,
          generation_reason,
          invalidated_at,
          invalidation_reason,
          refresh_completed_at
        ) VALUES (
          $1,
          $2,
          $3,
          $4,
          $5::jsonb,
          $6,
          $7,
          NOW(),
          $8,
          $9,
          $10,
          $11,
          $12,
          $13,
          NULL,
          NULL,
          NOW()
        )
        ON CONFLICT (account_id, profile_id, signal_family, schema_version)
        DO UPDATE SET
          payload_json = EXCLUDED.payload_json,
          item_count = EXCLUDED.item_count,
          limit_coverage = EXCLUDED.limit_coverage,
          materialized_at = EXCLUDED.materialized_at,
          expires_at = EXCLUDED.expires_at,
          source_version = EXCLUDED.source_version,
          source_latest_updated_at = EXCLUDED.source_latest_updated_at,
          is_complete = EXCLUDED.is_complete,
          empty_kind = EXCLUDED.empty_kind,
          generation_reason = EXCLUDED.generation_reason,
          invalidated_at = NULL,
          invalidation_reason = NULL,
          refresh_completed_at = EXCLUDED.refresh_completed_at`,
        [
          input.accountId,
          input.profileId,
          section.family,
          input.schemaVersion,
          JSON.stringify(section.payload),
          section.itemCount,
          section.limitCoverage,
          section.expiresAt ?? null,
          section.sourceVersion ?? null,
          section.sourceLatestUpdatedAt ?? null,
          section.isComplete,
          section.emptyKind,
          input.generationReason,
        ],
      );
    }
  }

  async invalidate(input: {
    accountId: string;
    profileId: string;
    families?: ProfileInputSignalFamily[];
    reason: ProfileInputSignalCacheInvalidationReason;
  }): Promise<void> {
    if (input.families?.length === 0) return;

    if (input.families) {
      await this.deps.db.query(
        `UPDATE profile_input_signal_cache_sections
        SET invalidated_at = COALESCE(invalidated_at, NOW()),
            invalidation_reason = $1
        WHERE account_id = $2
          AND profile_id = $3
          AND signal_family = ANY($4)`,
        [input.reason, input.accountId, input.profileId, input.families],
      );
      return;
    }

    await this.deps.db.query(
      `UPDATE profile_input_signal_cache_sections
      SET invalidated_at = COALESCE(invalidated_at, NOW()),
          invalidation_reason = $1
      WHERE account_id = $2
        AND profile_id = $3`,
      [input.reason, input.accountId, input.profileId],
    );
  }
}
