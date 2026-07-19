import type { QueryResult } from 'pg';
import type { DbClient } from '../../../lib/db.js';
import type { HomeSource, HomeWriteActor, HomeWriteList } from '../home-types.js';

type Queryable = { query: (text: string, params?: unknown[]) => Promise<QueryResult> };

export interface HomeWriteIdempotencyRecord {
  idempotencyKey: string;
  actorKey: string;
  operationKey: string;
  responseBody: unknown;
  requestHash: string;
  createdAt: Date;
}

export interface SaveHomeWriteIdempotencyInput {
  actorKey: string;
  operationKey: string;
  idempotencyKey: string;
  requestHash: string;
  responseBody: unknown;
  createdAt: Date;
}

export interface CreateHomeListVersionInput {
  accountId: string;
  profileId: string;
  source: HomeSource;
  listKey: string;
  sectionType: HomeWriteList['sectionType'];
  title: string;
  subtitle: string | null;
  items: unknown[];
  actor: HomeWriteActor;
  createdAt: Date;
}

export interface HomeListVersionRecord {
  accountId: string;
  profileId: string;
  source: HomeSource;
  listKey: string;
  version: number;
  itemCount: number;
  createdAt: Date;
}

export class HomeListsRepo {
  constructor(private readonly deps: { db: Queryable }) {}

  async findIdempotencyRecord(input: { actorKey: string; operationKey: string; idempotencyKey: string }): Promise<HomeWriteIdempotencyRecord | null> {
    const result = await this.deps.db.query(
      `SELECT actor_key, operation_key, idempotency_key, request_hash, response_body, created_at
       FROM recommendation_write_idempotency
       WHERE actor_key = $1 AND operation_key = $2 AND idempotency_key = $3`,
      [input.actorKey, input.operationKey, input.idempotencyKey],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      actorKey: String(row.actor_key),
      operationKey: String(row.operation_key),
      idempotencyKey: String(row.idempotency_key),
      requestHash: String(row.request_hash),
      responseBody: row.response_body,
      createdAt: new Date(row.created_at as string),
    };
  }

  async saveIdempotencyRecord(input: SaveHomeWriteIdempotencyInput): Promise<void> {
    await this.deps.db.query(
      `INSERT INTO recommendation_write_idempotency (actor_key, operation_key, idempotency_key, request_hash, response_body, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       ON CONFLICT (actor_key, operation_key, idempotency_key) DO NOTHING`,
      [input.actorKey, input.operationKey, input.idempotencyKey, input.requestHash, JSON.stringify(input.responseBody), input.createdAt],
    );
  }

  async hasActiveSourceRows(input: { accountId: string; profileId: string; source: HomeSource }): Promise<boolean> {
    const result = await this.deps.db.query(
      `SELECT 1 FROM recommendation_active_lists
       WHERE account_id = $1::uuid AND profile_id = $2::uuid AND source = $3 AND deleted_at IS NULL
       LIMIT 1`,
      [input.accountId, input.profileId, input.source],
    );
    return result.rows.length > 0;
  }

  /**
   * Whole-home atomic replace for a single source: deactivate every active list
   * row for this source, then insert fresh versions and activate them. Called
   * inside a single transaction so a failure leaves the previous rows intact.
   */
  async replaceHomeForSource(
    client: Queryable,
    input: {
      accountId: string;
      profileId: string;
      source: HomeSource;
      lists: Array<CreateHomeListVersionInput & { version: number; updatedAt: Date }>;
    },
  ): Promise<void> {
    await client.query(
      `UPDATE recommendation_active_lists
       SET deleted_at = NOW(), updated_at = NOW()
       WHERE account_id = $1::uuid AND profile_id = $2::uuid AND source = $3 AND deleted_at IS NULL`,
      [input.accountId, input.profileId, input.source],
    );
    for (const list of input.lists) {
      const actorId = list.actor.type === 'app' ? list.actor.appId : list.actor.accountId;
      const actorKeyId = list.actor.type === 'app' ? list.actor.keyId : list.actor.userId ?? null;
      await client.query(
        `INSERT INTO recommendation_list_versions
           (account_id, profile_id, source, list_key, version, title, subtitle, section_type, items_json, item_count, actor_type, actor_id, actor_key_id, created_at)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14)`,
        [list.accountId, list.profileId, list.source, list.listKey, list.version, list.title, list.subtitle, list.sectionType, JSON.stringify(list.items), list.items.length, list.actor.type, actorId, actorKeyId, list.createdAt],
      );
      await client.query(
        `INSERT INTO recommendation_active_lists (account_id, profile_id, source, list_key, active_version, updated_at)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)
         ON CONFLICT (account_id, profile_id, source, list_key)
         DO UPDATE SET active_version = EXCLUDED.active_version, updated_at = EXCLUDED.updated_at, deleted_at = NULL`,
        [list.accountId, list.profileId, list.source, list.listKey, list.version, list.updatedAt],
      );
    }
  }

  async nextVersion(input: { accountId: string; profileId: string; source: HomeSource; listKey: string }): Promise<number> {
    const result = await this.deps.db.query(
      `SELECT COALESCE(MAX(version), 0) + 1 AS version
       FROM recommendation_list_versions
       WHERE account_id = $1::uuid AND profile_id = $2::uuid AND source = $3 AND list_key = $4`,
      [input.accountId, input.profileId, input.source, input.listKey],
    );
    return Number(result.rows[0].version);
  }

  async clearHomeForSource(input: { accountId: string; profileId: string; source: HomeSource; clearedAt: Date }): Promise<void> {
    await this.deps.db.query(
      `UPDATE recommendation_active_lists
       SET deleted_at = $5, updated_at = $5
       WHERE account_id = $1::uuid AND profile_id = $2::uuid AND source = $3 AND deleted_at IS NULL`,
      [input.accountId, input.profileId, input.source, input.source, input.clearedAt],
    );
  }

  async listActiveForSource(input: { accountId: string; profileId: string; source: HomeSource }): Promise<Array<{
    listKey: string;
    sectionType: string;
    title: string;
    subtitle: string | null;
    version: number;
    items: unknown[];
    updatedAt: Date;
  }>> {
    const result = await this.deps.db.query(
      `SELECT v.list_key, v.section_type, v.title, v.subtitle, v.version, v.items_json, v.created_at
       FROM recommendation_active_lists a
       JOIN recommendation_list_versions v
         ON v.account_id = a.account_id AND v.profile_id = a.profile_id AND v.source = a.source AND v.list_key = a.list_key AND v.version = a.active_version
       WHERE a.account_id = $1::uuid AND a.profile_id = $2::uuid AND a.source = $3 AND a.deleted_at IS NULL
       ORDER BY v.created_at ASC`,
      [input.accountId, input.profileId, input.source],
    );
    return result.rows.map((row) => ({
      listKey: String(row.list_key),
      sectionType: String(row.section_type),
      title: String(row.title),
      subtitle: row.subtitle == null ? null : String(row.subtitle),
      version: Number(row.version),
      items: Array.isArray(row.items_json) ? (row.items_json as unknown[]) : [],
      updatedAt: new Date(row.created_at as string),
    }));
  }

  /** Active fallback rail templates for a given locale candidate list. */
  async listFallbackTemplatesForLocales(locales: string[]): Promise<Array<{
    listKey: string;
    locale: string;
    sectionType: string;
    title: string;
    subtitle: string | null;
    rank: number;
    sourceId: string;
    sourceConfig: Record<string, unknown>;
    refreshMinutes: number | null;
  }>> {
    const result = await this.deps.db.query(
      `SELECT list_key, locale, section_type, title, subtitle, rank, source_id, source_config, refresh_minutes
        FROM home.fallback_list_templates
        WHERE is_active AND locale = ANY($1::text[])
        ORDER BY rank ASC, list_key ASC`,
      [locales],
    );
    return result.rows.map((row) => ({
      listKey: String(row.list_key),
      locale: String(row.locale),
      sectionType: String(row.section_type),
      title: String(row.title),
      subtitle: row.subtitle == null ? null : String(row.subtitle),
      rank: Number(row.rank),
      sourceId: String(row.source_id),
      sourceConfig: (row.source_config as Record<string, unknown>) ?? {},
      refreshMinutes: row.refresh_minutes == null ? null : Number(row.refresh_minutes),
    }));
  }

  async listFallbackTemplatesForClient(client: DbClient): Promise<Array<{
    listKey: string;
    locale: string;
    sectionType: string;
    title: string;
    subtitle: string | null;
    rank: number;
    sourceId: string;
    sourceConfig: Record<string, unknown>;
    refreshMinutes: number | null;
  }>> {
    const result = await client.query(
      `SELECT list_key, locale, section_type, title, subtitle, rank, source_id, source_config, refresh_minutes
        FROM home.fallback_list_templates
        WHERE is_active
        ORDER BY rank ASC, list_key ASC`,
    );
    return result.rows.map((row) => ({
      listKey: String(row.list_key),
      locale: String(row.locale),
      sectionType: String(row.section_type),
      title: String(row.title),
      subtitle: row.subtitle == null ? null : String(row.subtitle),
      rank: Number(row.rank),
      sourceId: String(row.source_id),
      sourceConfig: (row.source_config as Record<string, unknown>) ?? {},
      refreshMinutes: row.refresh_minutes == null ? null : Number(row.refresh_minutes),
    }));
  }

  /** Upsert a fallback rail template. */
  async upsertFallbackTemplate(input: {
    listKey: string;
    locale: string;
    sectionType: string;
    title: string;
    subtitle: string | null;
    rank: number;
    sourceId: string;
    sourceConfig: Record<string, unknown>;
    refreshMinutes: number | null;
    updatedBy: string;
  }): Promise<void> {
    await this.deps.db.query(
      `INSERT INTO home.fallback_list_templates (list_key, locale, section_type, title, subtitle, rank, source_id, source_config, refresh_minutes, updated_by, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, now())
        ON CONFLICT (list_key, locale) DO UPDATE SET
          section_type = EXCLUDED.section_type,
          title = EXCLUDED.title,
          subtitle = EXCLUDED.subtitle,
          rank = EXCLUDED.rank,
          source_id = EXCLUDED.source_id,
          source_config = EXCLUDED.source_config,
          refresh_minutes = EXCLUDED.refresh_minutes,
          updated_by = EXCLUDED.updated_by,
          updated_at = EXCLUDED.updated_at`,
      [input.listKey, input.locale, input.sectionType, input.title, input.subtitle, input.rank, input.sourceId, JSON.stringify(input.sourceConfig), input.refreshMinutes, input.updatedBy],
    );
  }

  async deleteFallbackTemplate(listKey: string, locale: string): Promise<void> {
    await this.deps.db.query(
      'DELETE FROM home.fallback_list_templates WHERE list_key = $1 AND locale = $2',
      [listKey, locale],
    );
  }

  /** Resolved fallback rail cache (shared across profiles). */
  async getFallbackVersion(listKey: string, locale: string, sourceId: string): Promise<{
    sectionType: string;
    title: string;
    subtitle: string | null;
    rank: number;
    items: unknown[];
    refreshedAt: Date;
  } | null> {
    const result = await this.deps.db.query(
      `SELECT section_type, title, subtitle, rank, items_json, refreshed_at
        FROM home.fallback_list_versions
        WHERE list_key = $1 AND locale = $2 AND source_id = $3`,
      [listKey, locale, sourceId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      sectionType: String(row.section_type),
      title: String(row.title),
      subtitle: row.subtitle == null ? null : String(row.subtitle),
      rank: Number(row.rank),
      items: Array.isArray(row.items_json) ? (row.items_json as unknown[]) : [],
      refreshedAt: new Date(row.refreshed_at as string),
    };
  }

  async saveFallbackVersion(input: {
    listKey: string;
    locale: string;
    sourceId: string;
    sectionType: string;
    title: string;
    subtitle: string | null;
    rank: number;
    items: unknown[];
  }): Promise<void> {
    await this.deps.db.query(
      `INSERT INTO home.fallback_list_versions (list_key, locale, source_id, section_type, title, subtitle, rank, items_json, item_count, refreshed_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, now())
        ON CONFLICT (list_key, locale, source_id) DO UPDATE SET
          section_type = EXCLUDED.section_type,
          title = EXCLUDED.title,
          subtitle = EXCLUDED.subtitle,
          rank = EXCLUDED.rank,
          items_json = EXCLUDED.items_json,
          item_count = EXCLUDED.item_count,
          refreshed_at = EXCLUDED.refreshed_at`,
      [input.listKey, input.locale, input.sourceId, input.sectionType, input.title, input.subtitle, input.rank, JSON.stringify(input.items), input.items.length],
    );
  }

  /** Templates due for a scheduled refresh. */
  async listStaleFallbackTemplates(threshold: Date): Promise<Array<{
    listKey: string;
    locale: string;
    sourceId: string;
    sourceConfig: Record<string, unknown>;
    sectionType: string;
    title: string;
    subtitle: string | null;
    rank: number;
  }>> {
    const result = await this.deps.db.query(
      `SELECT list_key, locale, source_id, source_config, section_type, title, subtitle, rank
        FROM home.fallback_list_templates
        WHERE is_active AND refresh_minutes IS NOT NULL
          AND (last_refreshed_at IS NULL OR last_refreshed_at < $1)`,
      [threshold],
    );
    return result.rows.map((row) => ({
      listKey: String(row.list_key),
      locale: String(row.locale),
      sourceId: String(row.source_id),
      sourceConfig: (row.source_config as Record<string, unknown>) ?? {},
      sectionType: String(row.section_type),
      title: String(row.title),
      subtitle: row.subtitle == null ? null : String(row.subtitle),
      rank: Number(row.rank),
    }));
  }

  async markFallbackRefreshed(listKey: string, locale: string): Promise<void> {
    await this.deps.db.query(
      'UPDATE home.fallback_list_templates SET last_refreshed_at = now() WHERE list_key = $1 AND locale = $2',
      [listKey, locale],
    );
  }
}
