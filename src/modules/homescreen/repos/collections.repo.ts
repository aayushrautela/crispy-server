import type { DbClient } from '../../../lib/db.js';
import { requireDbIsoString } from '../../../lib/time.js';
import type { CollectionRecord, CollectionSource, ProviderRef } from '../homescreen.types.js';

function asProviderRefs(value: unknown): ProviderRef[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item): ProviderRef | null => {
      if (typeof item !== 'object' || item === null) {
        return null;
      }
      const record = item as Record<string, unknown>;
      const provider = typeof record.provider === 'string' ? record.provider : null;
      const providerId = typeof record.providerId === 'string' ? record.providerId : null;
      if (!provider || !providerId) {
        return null;
      }
      return {
        provider,
        providerId,
        type: typeof record.type === 'string' ? record.type : undefined,
      };
    })
    .filter((ref): ref is ProviderRef => ref !== null);
}

function mapCollection(row: Record<string, unknown>): CollectionRecord {
  return {
    key: String(row.key),
    title: String(row.title),
    subtitle: typeof row.subtitle === 'string' ? row.subtitle : null,
    providerRefs: asProviderRefs(row.provider_refs),
    source: (row.source === 'trakt' ? 'trakt' : 'manual') as CollectionSource,
    sourceRef: typeof row.source_ref === 'string' ? row.source_ref : null,
    lastSyncedAt: row.last_synced_at
      ? requireDbIsoString(row.last_synced_at as Date | string | null | undefined, 'collections.last_synced_at')
      : null,
    updatedBy: String(row.updated_by),
    updatedAt: requireDbIsoString(row.updated_at as Date | string | null | undefined, 'collections.updated_at'),
  };
}

export class CollectionsRepository {
  async list(client: DbClient, source?: CollectionSource): Promise<CollectionRecord[]> {
    const result = await client.query(
      `
        SELECT key, title, subtitle, provider_refs, source, source_ref, last_synced_at, updated_by, updated_at
        FROM homescreen.collections
        ${source ? 'WHERE source = $1' : ''}
        ORDER BY title ASC
      `,
      source ? [source] : [],
    );
    return result.rows.map((row) => mapCollection(row));
  }

  async get(client: DbClient, key: string): Promise<CollectionRecord | null> {
    const result = await client.query(
      `
        SELECT key, title, subtitle, provider_refs, source, source_ref, last_synced_at, updated_by, updated_at
        FROM homescreen.collections
        WHERE key = $1
        LIMIT 1
      `,
      [key],
    );
    return result.rows[0] ? mapCollection(result.rows[0]) : null;
  }

  async upsert(client: DbClient, params: {
    key: string;
    title: string;
    subtitle?: string | null;
    providerRefs: ProviderRef[];
    source: CollectionSource;
    sourceRef?: string | null;
    lastSyncedAt?: Date | string | null;
    updatedBy: string;
  }): Promise<CollectionRecord> {
    const result = await client.query(
      `
        INSERT INTO homescreen.collections (
          key, title, subtitle, provider_refs, source, source_ref, last_synced_at, updated_by, updated_at
        )
        VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::timestamptz, $8, now())
        ON CONFLICT (key)
        DO UPDATE SET
          title = EXCLUDED.title,
          subtitle = EXCLUDED.subtitle,
          provider_refs = EXCLUDED.provider_refs,
          source = EXCLUDED.source,
          source_ref = EXCLUDED.source_ref,
          last_synced_at = EXCLUDED.last_synced_at,
          updated_by = EXCLUDED.updated_by,
          updated_at = now()
        RETURNING key, title, subtitle, provider_refs, source, source_ref, last_synced_at, updated_by, updated_at
      `,
      [
        params.key,
        params.title,
        params.subtitle ?? null,
        JSON.stringify(params.providerRefs),
        params.source,
        params.sourceRef ?? null,
        params.lastSyncedAt ? requireDbIsoString(params.lastSyncedAt, 'collections.last_synced_at') : null,
        params.updatedBy,
      ],
    );
    return mapCollection(result.rows[0]);
  }

  async markSynced(client: DbClient, key: string, at: Date | string): Promise<void> {
    await client.query(
      `UPDATE homescreen.collections SET last_synced_at = $2::timestamptz, updated_at = now() WHERE key = $1`,
      [key, requireDbIsoString(at, 'collections.last_synced_at')],
    );
  }

  async delete(client: DbClient, key: string): Promise<void> {
    await client.query(`DELETE FROM homescreen.collections WHERE key = $1`, [key]);
  }
}
