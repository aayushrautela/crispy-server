import crypto from 'node:crypto';
import type pg from 'pg';

type QueryableDb = Pick<pg.Pool | pg.PoolClient, 'query'>;

export type AppAuditAction =
  | 'app_authenticated'
  | 'app_auth_failed'
  | 'app_scope_denied'
  | 'app_grant_denied'
  | 'eligible_profile_changes_read'
  | 'eligible_profile_snapshot_created'
  | 'eligible_profile_snapshot_items_claimed'
  | 'profile_eligibility_checked'
  | 'profile_signal_bundle_read'
  | 'service_recommendation_list_written'
  | 'service_recommendation_batch_written'
  | 'recommendation_run_created'
  | 'recommendation_run_updated'
  | 'recommendation_batch_created'
  | 'recommendation_batch_updated'
  | 'backfill_assignments_read'
  | 'confidential_config_bundle_read';

export interface AppAuditEventRecord {
  eventId: string;
  appId: string;
  keyId?: string | null;
  action: AppAuditAction;
  accountId?: string | null;
  profileId?: string | null;
  runId?: string | null;
  batchId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  requestId?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: Date;
}

export interface CreateAppAuditEventInput {
  appId: string;
  keyId?: string | null;
  action: AppAuditAction;
  accountId?: string | null;
  profileId?: string | null;
  runId?: string | null;
  batchId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  requestId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface PaginatedAppAuditEvents {
  events: AppAuditEventRecord[];
  cursor: { next?: string | null; hasMore: boolean };
}

export interface AppAuditRepo {
  insert(event: CreateAppAuditEventInput): Promise<AppAuditEventRecord>;
  listForApp(input: {
    appId: string;
    accountId?: string;
    profileId?: string;
    runId?: string;
    batchId?: string;
    cursor?: string;
    limit: number;
  }): Promise<PaginatedAppAuditEvents>;
}

export class SqlAppAuditRepo implements AppAuditRepo {
  constructor(private readonly deps: { db: QueryableDb }) {}

  async insert(event: CreateAppAuditEventInput): Promise<AppAuditEventRecord> {
    const result = await this.deps.db.query(
      `INSERT INTO app_audit_events
        (event_id, app_id, key_id, action, account_id, profile_id, run_id, batch_id,
         resource_type, resource_id, request_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING event_id, app_id, key_id, action, account_id, profile_id, run_id, batch_id,
                 resource_type, resource_id, request_id, metadata, created_at`,
      [
        crypto.randomUUID(),
        event.appId,
        event.keyId ?? null,
        event.action,
        event.accountId ?? null,
        event.profileId ?? null,
        event.runId ?? null,
        event.batchId ?? null,
        event.resourceType ?? null,
        event.resourceId ?? null,
        event.requestId ?? null,
        event.metadata ?? {},
      ],
    );
    return mapAuditRow(result.rows[0] as AppAuditEventRow);
  }

  async listForApp(input: {
    appId: string;
    accountId?: string;
    profileId?: string;
    runId?: string;
    batchId?: string;
    cursor?: string;
    limit: number;
  }): Promise<PaginatedAppAuditEvents> {
    const limit = Math.min(Math.max(input.limit, 1), 100);
    const values: unknown[] = [input.appId];
    const where = ['app_id = $1'];
    addOptionalFilter(where, values, 'account_id', input.accountId);
    addOptionalFilter(where, values, 'profile_id', input.profileId);
    addOptionalFilter(where, values, 'run_id', input.runId);
    addOptionalFilter(where, values, 'batch_id', input.batchId);
    if (input.cursor) {
      values.push(new Date(Buffer.from(input.cursor, 'base64url').toString('utf8')));
      where.push(`created_at < $${values.length}`);
    }
    values.push(limit + 1);

    const result = await this.deps.db.query(
      `SELECT event_id, app_id, key_id, action, account_id, profile_id, run_id, batch_id,
              resource_type, resource_id, request_id, metadata, created_at
         FROM app_audit_events
        WHERE ${where.join(' AND ')}
        ORDER BY created_at DESC, event_id DESC
        LIMIT $${values.length}`,
      values,
    );
    const rows = result.rows.map((row) => mapAuditRow(row as AppAuditEventRow));
    const events = rows.slice(0, limit);
    const last = events.at(-1);
    return {
      events,
      cursor: {
        hasMore: rows.length > limit,
        next: rows.length > limit && last ? Buffer.from(last.createdAt.toISOString()).toString('base64url') : null,
      },
    };
  }
}

interface AppAuditEventRow {
  event_id: string;
  app_id: string;
  key_id: string | null;
  action: AppAuditAction;
  account_id: string | null;
  profile_id: string | null;
  run_id: string | null;
  batch_id: string | null;
  resource_type: string | null;
  resource_id: string | null;
  request_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
}

function addOptionalFilter(where: string[], values: unknown[], column: string, value?: string): void {
  if (!value) return;
  values.push(value);
  where.push(`${column} = $${values.length}`);
}

function mapAuditRow(row: AppAuditEventRow): AppAuditEventRecord {
  return {
    eventId: row.event_id,
    appId: row.app_id,
    keyId: row.key_id,
    action: row.action,
    accountId: row.account_id,
    profileId: row.profile_id,
    runId: row.run_id,
    batchId: row.batch_id,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    requestId: row.request_id,
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}
