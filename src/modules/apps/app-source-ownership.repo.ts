import type pg from 'pg';
import { AppAuthError } from './app-auth.errors.js';

type QueryableDb = Pick<pg.Pool | pg.PoolClient, 'query'>;

export interface AppSourceOwnership {
  source: string;
  ownerAppId: string;
  allowedListKeys: string[];
  status: 'active' | 'disabled';
}

export interface AppSourceOwnershipRepo {
  findBySource(source: string): Promise<AppSourceOwnership | null>;
  findByAppId(appId: string): Promise<AppSourceOwnership[]>;
  assertAppOwnsSource(input: { appId: string; source: string }): Promise<void>;
  assertAppOwnsListKey(input: { appId: string; source: string; listKey: string }): Promise<void>;
}

export class SqlAppSourceOwnershipRepo implements AppSourceOwnershipRepo {
  constructor(private readonly deps: { db: QueryableDb }) {}

  async findBySource(source: string): Promise<AppSourceOwnership | null> {
    const result = await this.deps.db.query(
      `SELECT source, app_id, allowed_list_keys, status
         FROM app_source_ownership
        WHERE source = $1`,
      [source],
    );
    const row = result.rows[0] as AppSourceOwnershipRow | undefined;
    return row ? mapOwnershipRow(row) : null;
  }

  async findByAppId(appId: string): Promise<AppSourceOwnership[]> {
    const result = await this.deps.db.query(
      `SELECT source, app_id, allowed_list_keys, status
         FROM app_source_ownership
        WHERE app_id = $1
        ORDER BY source`,
      [appId],
    );
    return result.rows.map((row) => mapOwnershipRow(row as AppSourceOwnershipRow));
  }

  async assertAppOwnsSource(input: { appId: string; source: string }): Promise<void> {
    const ownership = await this.findBySource(input.source);
    if (!ownership || ownership.ownerAppId !== input.appId || ownership.status !== 'active') {
      throw new AppAuthError({
        code: 'app_grant_missing',
        message: `App does not own source: ${input.source}`,
        statusCode: 403,
      });
    }
  }

  async assertAppOwnsListKey(input: { appId: string; source: string; listKey: string }): Promise<void> {
    const ownership = await this.findBySource(input.source);
    if (
      !ownership ||
      ownership.ownerAppId !== input.appId ||
      ownership.status !== 'active' ||
      !ownership.allowedListKeys.includes(input.listKey)
    ) {
      throw new AppAuthError({
        code: 'app_grant_missing',
        message: `App does not own list key: ${input.listKey}`,
        statusCode: 403,
      });
    }
  }
}

interface AppSourceOwnershipRow {
  source: string;
  app_id: string;
  allowed_list_keys: string[];
  status: 'active' | 'disabled';
}

function mapOwnershipRow(row: AppSourceOwnershipRow): AppSourceOwnership {
  return {
    source: row.source,
    ownerAppId: row.app_id,
    allowedListKeys: row.allowed_list_keys,
    status: row.status,
  };
}
