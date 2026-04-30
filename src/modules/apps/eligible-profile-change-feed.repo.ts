import crypto from 'node:crypto';
import type pg from 'pg';
import type { EligibleProfileChangeEvent, EligibleProfileChangeEventType } from './eligible-profile-change-feed.types.js';

type QueryableDb = Pick<pg.Pool | pg.PoolClient, 'query'>;

export interface AppendEligibleProfileChangeInput {
  accountId: string;
  profileId: string;
  eventType: EligibleProfileChangeEventType;
  eligible: boolean;
  eligibilityVersion: number;
  signalsVersion: number;
  reasons: string[];
  recommendedActions: string[];
  changedAt: Date;
}

export interface EligibleProfileChangeEventWithSequence extends EligibleProfileChangeEvent {
  sequence: bigint;
}

export interface EligibleProfileChangeCheckpoint {
  appId: string;
  consumerId?: string | null;
  sequence: bigint;
  cursor: string;
  updatedAt: Date;
}

export interface EligibleProfileChangeFeedRepo {
  appendChange(input: AppendEligibleProfileChangeInput): Promise<EligibleProfileChangeEvent>;
  listChanges(input: {
    appId: string;
    afterSequence?: bigint;
    limit: number;
    reason?: string;
    accountId?: string;
    profileId?: string;
  }): Promise<EligibleProfileChangeEventWithSequence[]>;
  getCheckpoint(input: { appId: string; consumerId?: string }): Promise<EligibleProfileChangeCheckpoint | null>;
  saveCheckpoint(input: {
    appId: string;
    consumerId?: string;
    sequence: bigint;
    cursor: string;
    updatedAt: Date;
  }): Promise<void>;
}

export class SqlEligibleProfileChangeFeedRepo implements EligibleProfileChangeFeedRepo {
  constructor(private readonly deps: { db: QueryableDb }) {}

  async appendChange(input: AppendEligibleProfileChangeInput): Promise<EligibleProfileChangeEvent> {
    const result = await this.deps.db.query(
      `INSERT INTO eligible_profile_change_feed
         (change_id, account_id, profile_id, event_type, eligible, eligibility_version,
          signals_version, reasons, recommended_actions, changed_at)
       VALUES ($1, $2::uuid, $3::uuid, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10)
       RETURNING change_id, account_id, profile_id, event_type, eligible, eligibility_version,
                 signals_version, reasons, recommended_actions, changed_at`,
      [
        crypto.randomUUID(),
        input.accountId,
        input.profileId,
        input.eventType,
        input.eligible,
        input.eligibilityVersion,
        input.signalsVersion,
        JSON.stringify(input.reasons),
        JSON.stringify(input.recommendedActions),
        input.changedAt,
      ],
    );
    return mapChangeRow(result.rows[0]);
  }

  async listChanges(input: {
    appId: string;
    afterSequence?: bigint;
    limit: number;
    reason?: string;
    accountId?: string;
    profileId?: string;
  }): Promise<EligibleProfileChangeEventWithSequence[]> {
    const values: unknown[] = [];
    const where: string[] = [];

    if (input.afterSequence !== undefined) {
      values.push(input.afterSequence.toString());
      where.push(`sequence > $${values.length}::bigint`);
    }
    if (input.reason) {
      values.push(input.reason);
      where.push(`event_type = $${values.length}`);
    }
    if (input.accountId) {
      values.push(input.accountId);
      where.push(`account_id = $${values.length}::uuid`);
    }
    if (input.profileId) {
      values.push(input.profileId);
      where.push(`profile_id = $${values.length}::uuid`);
    }

    values.push(input.limit);

    const result = await this.deps.db.query(
      `SELECT sequence, change_id, account_id, profile_id, event_type, eligible,
              eligibility_version, signals_version, reasons, recommended_actions, changed_at
       FROM eligible_profile_change_feed
       ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY sequence ASC
       LIMIT $${values.length}`,
      values,
    );

    return result.rows.map((row) => ({
      ...mapChangeRow(row),
      sequence: BigInt(row.sequence),
    }));
  }

  async getCheckpoint(input: { appId: string; consumerId?: string }): Promise<EligibleProfileChangeCheckpoint | null> {
    const result = await this.deps.db.query(
      `SELECT app_id, consumer_id, sequence, cursor, updated_at
       FROM eligible_profile_change_checkpoints
       WHERE app_id = $1
         AND consumer_id IS NOT DISTINCT FROM $2`,
      [input.appId, input.consumerId ?? null],
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
      appId: row.app_id,
      consumerId: row.consumer_id,
      sequence: BigInt(row.sequence),
      cursor: row.cursor,
      updatedAt: row.updated_at,
    };
  }

  async saveCheckpoint(input: {
    appId: string;
    consumerId?: string;
    sequence: bigint;
    cursor: string;
    updatedAt: Date;
  }): Promise<void> {
    await this.deps.db.query(
      `INSERT INTO eligible_profile_change_checkpoints
         (app_id, consumer_id, sequence, cursor, updated_at)
       VALUES ($1, $2, $3::bigint, $4, $5)
       ON CONFLICT (app_id, consumer_id)
       DO UPDATE SET
         sequence = EXCLUDED.sequence,
         cursor = EXCLUDED.cursor,
         updated_at = EXCLUDED.updated_at`,
      [input.appId, input.consumerId ?? null, input.sequence.toString(), input.cursor, input.updatedAt],
    );
  }
}

function mapChangeRow(row: {
  change_id: string;
  account_id: string;
  profile_id: string;
  event_type: EligibleProfileChangeEventType;
  eligible: boolean;
  eligibility_version: number;
  signals_version: number;
  reasons: string[];
  recommended_actions: string[];
  changed_at: Date;
}): EligibleProfileChangeEvent {
  return {
    changeId: row.change_id,
    accountId: row.account_id,
    profileId: row.profile_id,
    eventType: row.event_type,
    eligible: row.eligible,
    eligibilityVersion: row.eligibility_version,
    signalsVersion: row.signals_version,
    changedAt: row.changed_at,
    reasons: row.reasons,
    recommendedActions: row.recommended_actions,
  };
}
