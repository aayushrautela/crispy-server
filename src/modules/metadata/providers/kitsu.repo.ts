import type { DbClient } from '../../../lib/db.js';
import { requireDbIsoString } from '../../../lib/time.js';
import type { CachedKitsuTitleBundleRecord, KitsuTitleBundlePayload } from './provider-bundle.types.js';

function mapBundle(row: Record<string, unknown>): CachedKitsuTitleBundleRecord {
  return {
    providerId: String(row.provider_id),
    payload: ((row.payload as Record<string, unknown> | undefined) ?? {}) as KitsuTitleBundlePayload,
    fetchedAt: requireDbIsoString(row.fetched_at as Date | string | null | undefined, 'kitsu_title_bundles.fetched_at'),
    expiresAt: requireDbIsoString(row.expires_at as Date | string | null | undefined, 'kitsu_title_bundles.expires_at'),
  };
}

export class KitsuRepository {
  async getTitleBundle(client: DbClient, providerId: string): Promise<CachedKitsuTitleBundleRecord | null> {
    const result = await client.query(
      `
        SELECT provider_id, payload, fetched_at, expires_at
        FROM kitsu_title_bundles
        WHERE provider_id = $1
      `,
      [providerId],
    );
    return result.rows[0] ? mapBundle(result.rows[0] as Record<string, unknown>) : null;
  }

  async upsertTitleBundle(client: DbClient, record: CachedKitsuTitleBundleRecord): Promise<void> {
    await client.query(
      `
        INSERT INTO kitsu_title_bundles (provider_id, payload, fetched_at, expires_at)
        VALUES ($1, $2::jsonb, $3::timestamptz, $4::timestamptz)
        ON CONFLICT (provider_id)
        DO UPDATE SET
          payload = EXCLUDED.payload,
          fetched_at = EXCLUDED.fetched_at,
          expires_at = EXCLUDED.expires_at
      `,
      [record.providerId, JSON.stringify(record.payload), record.fetchedAt, record.expiresAt],
    );
  }
}
