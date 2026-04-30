import type pg from 'pg';
import type { AppKeyId, AppKeyRecord } from './app-principal.types.js';

type QueryableDb = Pick<pg.Pool | pg.PoolClient, 'query'>;

export interface AppKeyRepo {
  findKeyById(keyId: AppKeyId): Promise<AppKeyRecord | null>;
  updateLastUsedAt(keyId: AppKeyId, usedAt: Date): Promise<void>;
  createKey(input: CreateAppKeyRecordInput): Promise<AppKeyRecord>;
  disableKey(keyId: AppKeyId, disabledAt: Date): Promise<void>;
  revokeKey(keyId: AppKeyId, revokedAt: Date): Promise<void>;
}

export interface CreateAppKeyRecordInput {
  keyId: string;
  appId: string;
  keyHash: string;
  status: 'active';
  expiresAt?: Date | null;
  rotationGroup?: string | null;
  allowedIpCidrs?: string[] | null;
  metadata?: Record<string, unknown> | null;
}

export class SqlAppKeyRepo implements AppKeyRepo {
  constructor(private readonly deps: { db: QueryableDb }) {}

  async findKeyById(keyId: AppKeyId): Promise<AppKeyRecord | null> {
    const result = await this.deps.db.query(
      `SELECT key_id, app_id, key_hash, status, created_at, expires_at, last_used_at,
              rotation_group, allowed_ip_cidrs, metadata
         FROM app_keys
        WHERE key_id = $1`,
      [keyId],
    );
    const row = result.rows[0] as AppKeyRow | undefined;
    return row ? mapKeyRow(row) : null;
  }

  async updateLastUsedAt(keyId: AppKeyId, usedAt: Date): Promise<void> {
    await this.deps.db.query('UPDATE app_keys SET last_used_at = $2 WHERE key_id = $1', [keyId, usedAt]);
  }

  async createKey(input: CreateAppKeyRecordInput): Promise<AppKeyRecord> {
    const result = await this.deps.db.query(
      `INSERT INTO app_keys (key_id, app_id, key_hash, status, expires_at, rotation_group, allowed_ip_cidrs, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING key_id, app_id, key_hash, status, created_at, expires_at, last_used_at,
                 rotation_group, allowed_ip_cidrs, metadata`,
      [
        input.keyId,
        input.appId,
        input.keyHash,
        input.status,
        input.expiresAt ?? null,
        input.rotationGroup ?? null,
        input.allowedIpCidrs ?? null,
        input.metadata ?? {},
      ],
    );
    return mapKeyRow(result.rows[0] as AppKeyRow);
  }

  async disableKey(keyId: AppKeyId, disabledAt: Date): Promise<void> {
    await this.deps.db.query(
      `UPDATE app_keys
          SET status = 'disabled', disabled_at = $2
        WHERE key_id = $1`,
      [keyId, disabledAt],
    );
  }

  async revokeKey(keyId: AppKeyId, revokedAt: Date): Promise<void> {
    await this.deps.db.query(
      `UPDATE app_keys
          SET status = 'revoked', revoked_at = $2
        WHERE key_id = $1`,
      [keyId, revokedAt],
    );
  }
}

interface AppKeyRow {
  key_id: string;
  app_id: string;
  key_hash: string;
  status: AppKeyRecord['status'];
  created_at: Date;
  expires_at: Date | null;
  last_used_at: Date | null;
  rotation_group: string | null;
  allowed_ip_cidrs: string[] | null;
  metadata: Record<string, unknown> | null;
}

function mapKeyRow(row: AppKeyRow): AppKeyRecord {
  return {
    keyId: row.key_id,
    appId: row.app_id,
    keyHash: row.key_hash,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    rotationGroup: row.rotation_group,
    allowedIpCidrs: row.allowed_ip_cidrs,
    metadata: row.metadata,
  };
}
