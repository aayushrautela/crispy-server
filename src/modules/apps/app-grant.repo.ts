import type pg from 'pg';
import type {
  AppGrant,
  AppGrantAction,
  AppGrantConstraintSet,
  AppGrantResourceType,
  AppId,
  AppPurpose,
} from './app-principal.types.js';

type QueryableDb = Pick<pg.Pool | pg.PoolClient, 'query'>;

export interface AppGrantRepo {
  listActiveGrantsForApp(appId: AppId, now: Date): Promise<AppGrant[]>;
  findMatchingGrant(input: FindMatchingAppGrantInput): Promise<AppGrant | null>;
}

export interface FindMatchingAppGrantInput {
  appId: AppId;
  resourceType: AppGrantResourceType;
  resourceId: string;
  purpose: AppPurpose;
  action: AppGrantAction;
  accountId?: string;
  profileId?: string;
  listKey?: string;
  source?: string;
  now: Date;
}

export class SqlAppGrantRepo implements AppGrantRepo {
  constructor(private readonly deps: { db: QueryableDb }) {}

  async listActiveGrantsForApp(appId: AppId, now: Date): Promise<AppGrant[]> {
    const result = await this.deps.db.query(
      `SELECT grant_id, app_id, resource_type, resource_id, purpose, actions,
              constraints, status, created_at, expires_at
         FROM app_grants
        WHERE app_id = $1
          AND status = 'active'
          AND (expires_at IS NULL OR expires_at > $2)
        ORDER BY created_at ASC`,
      [appId, now],
    );
    return result.rows.map((row) => mapGrantRow(row as AppGrantRow));
  }

  async findMatchingGrant(input: FindMatchingAppGrantInput): Promise<AppGrant | null> {
    const grants = await this.listActiveGrantsForApp(input.appId, input.now);
    return grants.find((grant) => grantMatches(grant, input)) ?? null;
  }
}

interface AppGrantRow {
  grant_id: string;
  app_id: string;
  resource_type: AppGrantResourceType;
  resource_id: string;
  purpose: AppPurpose;
  actions: AppGrantAction[];
  constraints: AppGrantConstraintSet | null;
  status: AppGrant['status'];
  created_at: Date;
  expires_at: Date | null;
}

export function grantMatches(grant: AppGrant, input: Omit<FindMatchingAppGrantInput, 'now'>): boolean {
  if (grant.appId !== input.appId) return false;
  if (grant.status !== 'active') return false;
  if (grant.resourceType !== input.resourceType) return false;
  if (grant.resourceId !== '*' && grant.resourceId !== input.resourceId) return false;
  if (grant.purpose !== input.purpose) return false;
  if (!grant.actions.includes(input.action)) return false;

  const constraints = grant.constraints;
  if (constraints.accountIds && input.accountId && !constraints.accountIds.includes(input.accountId)) return false;
  if (constraints.profileIds && input.profileId && !constraints.profileIds.includes(input.profileId)) return false;
  if (constraints.listKey && input.listKey && constraints.listKey !== input.listKey) return false;
  if (constraints.source && input.source && constraints.source !== input.source) return false;

  return true;
}

function mapGrantRow(row: AppGrantRow): AppGrant {
  return {
    grantId: row.grant_id,
    appId: row.app_id,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    purpose: row.purpose,
    actions: row.actions,
    constraints: row.constraints ?? {},
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}
