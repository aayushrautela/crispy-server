import crypto from 'node:crypto';
import type pg from 'pg';
import type {
  CountEligibleProfilesForSnapshotInput,
  CreateEligibleProfileSnapshotInput,
  EligibleProfileSnapshot,
  EligibleProfileSnapshotItem,
  EligibleProfileSnapshotItemStatus,
  EligibleProfileSnapshotStatus,
} from './eligible-profile-snapshot.types.js';

type QueryableDb = Pick<pg.Pool | pg.PoolClient, 'query'>;

export interface EligibleProfileSnapshotRepo {
  createSnapshot(input: CreateEligibleProfileSnapshotInput): Promise<EligibleProfileSnapshot>;
  countEligibleProfilesForSnapshot(input: CountEligibleProfilesForSnapshotInput): Promise<number>;
  populateSnapshotItems(input: { snapshotId: string; limit?: number }): Promise<number>;
  getSnapshot(snapshotId: string): Promise<EligibleProfileSnapshot | null>;
  listAndLeaseItems(input: {
    snapshotId: string;
    appId: string;
    afterOffset?: number;
    limit: number;
    leaseSeconds?: number;
    now: Date;
  }): Promise<EligibleProfileSnapshotItem[]>;
  markItemsCompleted(input: { snapshotItemIds: string[]; completedAt: Date }): Promise<void>;
}

export class SqlEligibleProfileSnapshotRepo implements EligibleProfileSnapshotRepo {
  constructor(private readonly deps: { db: QueryableDb }) {}

  async createSnapshot(input: CreateEligibleProfileSnapshotInput): Promise<EligibleProfileSnapshot> {
    const snapshotId = crypto.randomUUID();
    const estimatedProfileCount = await this.countEligibleProfilesForSnapshot({
      appId: input.appId,
      purpose: input.purpose,
      filters: input.filters,
    });

    const result = await this.deps.db.query(
      `INSERT INTO eligible_profile_snapshots
         (snapshot_id, app_id, purpose, status, filters, reason, requested_by, estimated_profile_count, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8, $9)
       RETURNING snapshot_id, app_id, purpose, status, filters, estimated_profile_count, created_at, approved_by, approved_at`,
      [
        snapshotId,
        input.appId,
        input.purpose,
        input.status,
        JSON.stringify(input.filters),
        input.reason,
        JSON.stringify(input.requestedBy ?? null),
        estimatedProfileCount,
        input.createdAt,
      ],
    );

    await this.populateSnapshotItems({ snapshotId });
    return mapSnapshotRow(result.rows[0]);
  }

  async countEligibleProfilesForSnapshot(input: CountEligibleProfilesForSnapshotInput): Promise<number> {
    const filters = input.filters as { accountIds?: string[]; profileIds?: string[] };
    const values: unknown[] = [input.purpose];
    const where = ['pep.purpose = $1', 'pep.eligible = true'];

    if (filters.accountIds?.length) {
      values.push(filters.accountIds);
      where.push(`pep.account_id = ANY($${values.length}::uuid[])`);
    }
    if (filters.profileIds?.length) {
      values.push(filters.profileIds);
      where.push(`pep.profile_id = ANY($${values.length}::uuid[])`);
    }

    const result = await this.deps.db.query(
      `SELECT count(*)::integer AS count
       FROM profile_eligibility_projections pep
       WHERE ${where.join(' AND ')}`,
      values,
    );
    return result.rows[0]?.count ?? 0;
  }

  async populateSnapshotItems(input: { snapshotId: string; limit?: number }): Promise<number> {
    const result = await this.deps.db.query(
      `WITH snapshot AS (
         SELECT snapshot_id, purpose, filters
         FROM eligible_profile_snapshots
         WHERE snapshot_id = $1
       ), inserted AS (
         INSERT INTO eligible_profile_snapshot_items
           (snapshot_item_id, snapshot_id, item_offset, account_id, profile_id, eligibility_version, signals_version, status)
         SELECT gen_random_uuid(), s.snapshot_id,
                row_number() OVER (ORDER BY pep.account_id, pep.profile_id) - 1,
                pep.account_id, pep.profile_id, pep.eligibility_version,
                COALESCE(psv.signals_version, 0), 'pending'
         FROM snapshot s
         INNER JOIN profile_eligibility_projections pep ON pep.purpose = s.purpose AND pep.eligible = true
         LEFT JOIN profile_signal_versions psv ON psv.account_id = pep.account_id AND psv.profile_id = pep.profile_id
         WHERE (NOT (s.filters ? 'accountIds') OR pep.account_id IN (SELECT jsonb_array_elements_text(s.filters->'accountIds')::uuid))
           AND (NOT (s.filters ? 'profileIds') OR pep.profile_id IN (SELECT jsonb_array_elements_text(s.filters->'profileIds')::uuid))
         ORDER BY pep.account_id, pep.profile_id
         LIMIT COALESCE($2::integer, 1000000)
         ON CONFLICT (snapshot_id, account_id, profile_id) DO NOTHING
         RETURNING 1
       )
       SELECT count(*)::integer AS count FROM inserted`,
      [input.snapshotId, input.limit ?? null],
    );
    return result.rows[0]?.count ?? 0;
  }

  async getSnapshot(snapshotId: string): Promise<EligibleProfileSnapshot | null> {
    const result = await this.deps.db.query(
      `SELECT snapshot_id, app_id, purpose, status, filters, estimated_profile_count, created_at, approved_by, approved_at
       FROM eligible_profile_snapshots
       WHERE snapshot_id = $1`,
      [snapshotId],
    );
    return result.rows[0] ? mapSnapshotRow(result.rows[0]) : null;
  }

  async listAndLeaseItems(input: {
    snapshotId: string;
    appId: string;
    afterOffset?: number;
    limit: number;
    leaseSeconds?: number;
    now: Date;
  }): Promise<EligibleProfileSnapshotItem[]> {
    const leaseId = crypto.randomUUID();
    const result = await this.deps.db.query(
      `WITH selected AS (
         SELECT i.snapshot_item_id
         FROM eligible_profile_snapshot_items i
         INNER JOIN eligible_profile_snapshots s ON s.snapshot_id = i.snapshot_id
         WHERE i.snapshot_id = $1
           AND s.app_id = $2
           AND i.item_offset > $3
           AND i.status IN ('pending', 'leased')
           AND (i.lease_expires_at IS NULL OR i.lease_expires_at <= $4)
         ORDER BY i.item_offset ASC
         LIMIT $5
       ), updated AS (
         UPDATE eligible_profile_snapshot_items i
         SET status = 'leased',
             lease_id = $6,
             lease_expires_at = $4 + make_interval(secs => $7::integer),
             updated_at = $4
         FROM selected
         WHERE i.snapshot_item_id = selected.snapshot_item_id
         RETURNING i.snapshot_item_id, i.snapshot_id, i.account_id, i.profile_id, i.eligibility_version,
                   i.signals_version, i.status, i.lease_id, i.lease_expires_at
       )
       SELECT * FROM updated`,
      [input.snapshotId, input.appId, input.afterOffset ?? -1, input.now, input.limit, leaseId, input.leaseSeconds ?? 900],
    );

    return result.rows.map(mapSnapshotItemRow);
  }

  async markItemsCompleted(input: { snapshotItemIds: string[]; completedAt: Date }): Promise<void> {
    await this.deps.db.query(
      `UPDATE eligible_profile_snapshot_items
       SET status = 'completed', completed_at = $2, updated_at = $2
       WHERE snapshot_item_id = ANY($1::uuid[])`,
      [input.snapshotItemIds, input.completedAt],
    );
  }
}

function mapSnapshotRow(row: {
  snapshot_id: string;
  app_id: string;
  purpose: 'recommendation-generation';
  status: EligibleProfileSnapshotStatus;
  filters: Record<string, unknown>;
  estimated_profile_count: number;
  created_at: Date;
  approved_by: string | null;
  approved_at: Date | null;
}): EligibleProfileSnapshot {
  return {
    snapshotId: row.snapshot_id,
    appId: row.app_id,
    purpose: row.purpose,
    status: row.status,
    filters: row.filters,
    estimatedProfileCount: row.estimated_profile_count,
    createdAt: row.created_at,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
  };
}

function mapSnapshotItemRow(row: {
  snapshot_item_id: string;
  snapshot_id: string;
  account_id: string;
  profile_id: string;
  eligibility_version: number;
  signals_version: number;
  status: EligibleProfileSnapshotItemStatus;
  lease_id: string | null;
  lease_expires_at: Date | null;
}): EligibleProfileSnapshotItem {
  return {
    snapshotItemId: row.snapshot_item_id,
    snapshotId: row.snapshot_id,
    accountId: row.account_id,
    profileId: row.profile_id,
    eligibilityVersion: row.eligibility_version,
    signalsVersion: row.signals_version,
    status: row.status,
    lease: row.lease_id && row.lease_expires_at ? { leaseId: row.lease_id, expiresAt: row.lease_expires_at } : undefined,
  };
}
