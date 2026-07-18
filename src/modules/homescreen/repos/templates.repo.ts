import type { DbClient } from '../../../lib/db.js';
import { requireDbIsoString } from '../../../lib/time.js';
import type { TemplateRecord } from '../homescreen.types.js';

function mapTemplate(row: Record<string, unknown>): TemplateRecord {
  return {
    key: String(row.key),
    locale: String(row.locale),
    title: typeof row.title === 'string' ? row.title : null,
    sectionKeys: Array.isArray(row.section_keys) ? row.section_keys.map((value) => String(value)) : [],
    isActive: Boolean(row.is_active),
    updatedBy: String(row.updated_by),
    updatedAt: requireDbIsoString(row.updated_at as Date | string | null | undefined, 'templates.updated_at'),
  };
}

export class TemplatesRepository {
  async getActive(client: DbClient, locale: string): Promise<TemplateRecord | null> {
    const result = await client.query(
      `
        SELECT key, locale, title, section_keys, is_active, updated_by, updated_at
        FROM homescreen.templates
        WHERE locale = $1 AND is_active = true
        LIMIT 1
      `,
      [locale],
    );
    return result.rows[0] ? mapTemplate(result.rows[0]) : null;
  }

  async getByKey(client: DbClient, key: string, locale: string): Promise<TemplateRecord | null> {
    const result = await client.query(
      `
        SELECT key, locale, title, section_keys, is_active, updated_by, updated_at
        FROM homescreen.templates
        WHERE key = $1 AND locale = $2
        LIMIT 1
      `,
      [key, locale],
    );
    return result.rows[0] ? mapTemplate(result.rows[0]) : null;
  }

  async list(client: DbClient, locale?: string): Promise<TemplateRecord[]> {
    const result = await client.query(
      `
        SELECT key, locale, title, section_keys, is_active, updated_by, updated_at
        FROM homescreen.templates
        ${locale ? 'WHERE locale = $1' : ''}
        ORDER BY locale ASC, key ASC
      `,
      locale ? [locale] : [],
    );
    return result.rows.map((row) => mapTemplate(row));
  }

  async upsert(
    client: DbClient,
    params: { key: string; locale: string; title: string | null; sectionKeys: string[]; isActive: boolean; updatedBy: string },
  ): Promise<TemplateRecord> {
    const result = await client.query(
      `
        INSERT INTO homescreen.templates (key, locale, title, section_keys, is_active, updated_by, updated_at)
        VALUES ($1, $2, $3, $4::text[], $5, $6, now())
        ON CONFLICT (key, locale)
        DO UPDATE SET
          title = EXCLUDED.title,
          section_keys = EXCLUDED.section_keys,
          is_active = EXCLUDED.is_active,
          updated_by = EXCLUDED.updated_by,
          updated_at = now()
        RETURNING key, locale, title, section_keys, is_active, updated_by, updated_at
      `,
      [params.key, params.locale, params.title ?? null, params.sectionKeys, params.isActive, params.updatedBy],
    );
    return mapTemplate(result.rows[0]);
  }

  async setActive(client: DbClient, key: string, locale: string, updatedBy: string): Promise<TemplateRecord> {
    await client.query(
      `UPDATE homescreen.templates SET is_active = false WHERE locale = $1`,
      [locale],
    );
    const result = await client.query(
      `
        UPDATE homescreen.templates
        SET is_active = true, updated_by = $3, updated_at = now()
        WHERE key = $1 AND locale = $2
        RETURNING key, locale, title, section_keys, is_active, updated_by, updated_at
      `,
      [key, locale, updatedBy],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error(`Template not found: ${key}/${locale}`);
    }
    return mapTemplate(row);
  }

  async delete(client: DbClient, key: string, locale: string): Promise<void> {
    await client.query(
      `DELETE FROM homescreen.templates WHERE key = $1 AND locale = $2`,
      [key, locale],
    );
  }
}
