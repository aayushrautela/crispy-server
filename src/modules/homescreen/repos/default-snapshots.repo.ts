import type { DbClient } from '../../../lib/db.js';
import { requireDbIsoString, toDbIsoString } from '../../../lib/time.js';
import type { ClientHomeSection } from '../../recommendations/client-home.types.js';
import type { DefaultSnapshotRecord } from '../homescreen.types.js';

function mapSnapshot(row: Record<string, unknown>): DefaultSnapshotRecord {
  return {
    locale: String(row.locale),
    sections: Array.isArray(row.sections) ? (row.sections as ClientHomeSection[]) : [],
    generatedAt: requireDbIsoString(row.generated_at as Date | string | null | undefined, 'default_snapshots.generated_at'),
    expiresAt: toDbIsoString(row.expires_at as Date | string | null | undefined, 'default_snapshots.expires_at'),
    lastError: typeof row.last_error === 'string' ? row.last_error : null,
    updatedBy: typeof row.updated_by === 'string' ? row.updated_by : null,
    updatedAt: requireDbIsoString(row.updated_at as Date | string | null | undefined, 'default_snapshots.updated_at'),
  };
}

export class DefaultSnapshotsRepository {
  async get(client: DbClient, locale: string): Promise<DefaultSnapshotRecord | null> {
    const result = await client.query(
      `
        SELECT locale, sections, generated_at, expires_at, last_error, updated_by, updated_at
        FROM homescreen.default_snapshots
        WHERE locale = $1
        LIMIT 1
      `,
      [locale],
    );
    return result.rows[0] ? mapSnapshot(result.rows[0]) : null;
  }

  async listLocales(client: DbClient): Promise<DefaultSnapshotRecord[]> {
    const result = await client.query(
      `
        SELECT locale, sections, generated_at, expires_at, last_error, updated_by, updated_at
        FROM homescreen.default_snapshots
        ORDER BY locale ASC
      `,
    );
    return result.rows.map((row) => mapSnapshot(row));
  }

  async upsert(client: DbClient, params: {
    locale: string;
    sections: ClientHomeSection[];
    generatedAt: Date | string;
    expiresAt?: Date | string | null;
    lastError?: string | null;
    updatedBy?: string | null;
  }): Promise<DefaultSnapshotRecord> {
    const result = await client.query(
      `
        INSERT INTO homescreen.default_snapshots (
          locale, sections, generated_at, expires_at, last_error, updated_by, updated_at
        )
        VALUES ($1, $2::jsonb, $3::timestamptz, $4::timestamptz, $5, $6, now())
        ON CONFLICT (locale)
        DO UPDATE SET
          sections = EXCLUDED.sections,
          generated_at = EXCLUDED.generated_at,
          expires_at = EXCLUDED.expires_at,
          last_error = EXCLUDED.last_error,
          updated_by = EXCLUDED.updated_by,
          updated_at = now()
        RETURNING locale, sections, generated_at, expires_at, last_error, updated_by, updated_at
      `,
      [
        params.locale,
        JSON.stringify(params.sections),
        requireDbIsoString(params.generatedAt, 'default_snapshots.generated_at'),
        toDbIsoString(params.expiresAt ?? null, 'default_snapshots.expires_at'),
        params.lastError ?? null,
        params.updatedBy ?? null,
      ],
    );
    return mapSnapshot(result.rows[0]);
  }

  async delete(client: DbClient, locale: string): Promise<void> {
    await client.query(`DELETE FROM homescreen.default_snapshots WHERE locale = $1`, [locale]);
  }
}
