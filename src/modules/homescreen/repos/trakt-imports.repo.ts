import type { DbClient } from '../../../lib/db.js';
import { requireDbIsoString } from '../../../lib/time.js';
import type { TraktImportRecord } from '../homescreen.types.js';

function mapTraktImport(row: Record<string, unknown>): TraktImportRecord {
  return {
    id: String(row.id),
    traktListId: typeof row.trakt_list_id === 'string' ? row.trakt_list_id : null,
    slug: String(row.slug),
    title: typeof row.title === 'string' ? row.title : null,
    templateKey: String(row.template_key),
    active: Boolean(row.active),
    lastSyncedAt: row.last_synced_at
      ? requireDbIsoString(row.last_synced_at as Date | string | null | undefined, 'trakt_imports.last_synced_at')
      : null,
    lastError: typeof row.last_error === 'string' ? row.last_error : null,
    updatedAt: requireDbIsoString(row.updated_at as Date | string | null | undefined, 'trakt_imports.updated_at'),
  };
}

export class TraktImportsRepository {
  async list(client: DbClient): Promise<TraktImportRecord[]> {
    const result = await client.query(
      `
        SELECT id, trakt_list_id, slug, title, template_key, active, last_synced_at, last_error, updated_at
        FROM homescreen.trakt_imports
        ORDER BY slug ASC
      `,
    );
    return result.rows.map((row) => mapTraktImport(row));
  }

  async get(client: DbClient, id: string): Promise<TraktImportRecord | null> {
    const result = await client.query(
      `
        SELECT id, trakt_list_id, slug, title, template_key, active, last_synced_at, last_error, updated_at
        FROM homescreen.trakt_imports
        WHERE id = $1::uuid
        LIMIT 1
      `,
      [id],
    );
    return result.rows[0] ? mapTraktImport(result.rows[0]) : null;
  }

  async create(client: DbClient, params: {
    slug: string;
    title?: string | null;
    traktListId?: string | null;
    templateKey: string;
    active?: boolean;
  }): Promise<TraktImportRecord> {
    const result = await client.query(
      `
        INSERT INTO homescreen.trakt_imports (trakt_list_id, slug, title, template_key, active, updated_at)
        VALUES ($1, $2, $3, $4, $5, now())
        RETURNING id, trakt_list_id, slug, title, template_key, active, last_synced_at, last_error, updated_at
      `,
      [
        params.traktListId ?? null,
        params.slug,
        params.title ?? null,
        params.templateKey,
        params.active ?? true,
      ],
    );
    return mapTraktImport(result.rows[0]);
  }

  async update(client: DbClient, id: string, patch: {
    slug?: string;
    title?: string | null;
    traktListId?: string | null;
    templateKey?: string;
    active?: boolean;
  }): Promise<TraktImportRecord | null> {
    const result = await client.query(
      `
        UPDATE homescreen.trakt_imports
        SET
          slug = COALESCE($2, slug),
          title = COALESCE($3, title),
          trakt_list_id = COALESCE($4, trakt_list_id),
          template_key = COALESCE($5, template_key),
          active = COALESCE($6, active),
          updated_at = now()
        WHERE id = $1::uuid
        RETURNING id, trakt_list_id, slug, title, template_key, active, last_synced_at, last_error, updated_at
      `,
      [
        id,
        patch.slug ?? null,
        patch.title === undefined ? null : patch.title,
        patch.traktListId ?? null,
        patch.templateKey ?? null,
        patch.active === undefined ? null : patch.active,
      ],
    );
    return result.rows[0] ? mapTraktImport(result.rows[0]) : null;
  }

  async markSynced(client: DbClient, id: string, at: Date | string, error?: string | null): Promise<void> {
    await client.query(
      `
        UPDATE homescreen.trakt_imports
        SET last_synced_at = $2::timestamptz, last_error = $3, updated_at = now()
        WHERE id = $1::uuid
      `,
      [id, requireDbIsoString(at, 'trakt_imports.last_synced_at'), error === undefined ? null : (error ?? null)],
    );
  }

  async delete(client: DbClient, id: string): Promise<void> {
    await client.query(`DELETE FROM homescreen.trakt_imports WHERE id = $1::uuid`, [id]);
  }
}
