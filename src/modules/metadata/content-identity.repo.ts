import type { DbClient } from '../../lib/db.js';

export type ContentEntityType = 'movie' | 'show' | 'episode' | 'season' | 'person';

export type ContentProviderRefInput = {
  provider: string;
  entityType: ContentEntityType;
  externalId: string;
  metadata?: Record<string, unknown>;
};

export type ContentProviderRefRecord = {
  contentId: string;
  provider: string;
  entityType: ContentEntityType;
  externalId: string;
  metadata: Record<string, unknown>;
};

function mapProviderRef(row: Record<string, unknown>): ContentProviderRefRecord {
  return {
    contentId: String(row.content_id),
    provider: String(row.provider),
    entityType: String(row.entity_type) as ContentEntityType,
    externalId: String(row.external_id),
    metadata: (row.metadata as Record<string, unknown> | undefined) ?? {},
  };
}

export class ContentIdentityRepository {
  async ensureProviderRefs(client: DbClient, refs: ContentProviderRefInput[]): Promise<ContentProviderRefRecord[]> {
    const deduped = dedupeRefs(refs);
    if (!deduped.length) {
      return [];
    }

    const values: unknown[] = [];
    const tuples = deduped.map((ref, index) => {
      const base = index * 5;
      values.push(index + 1, ref.provider, ref.entityType, ref.externalId, JSON.stringify(ref.metadata ?? {}));
      return `($${base + 1}::integer, $${base + 2}::text, $${base + 3}::text, $${base + 4}::text, $${base + 5}::jsonb)`;
    });

    const result = await client.query(
      `
        WITH incoming(ord, provider, entity_type, external_id, metadata) AS (
          VALUES ${tuples.join(', ')}
        ),
        missing AS (
          SELECT i.*, gen_random_uuid() AS content_id
          FROM incoming i
          LEFT JOIN content_provider_refs existing
            ON existing.provider = i.provider
           AND existing.entity_type = i.entity_type
           AND existing.external_id = i.external_id
          WHERE existing.content_id IS NULL
        ),
        inserted_items AS (
          INSERT INTO content_items (id, entity_type)
          SELECT content_id, entity_type
          FROM missing
          ON CONFLICT (id) DO NOTHING
        ),
        inserted_refs AS (
          INSERT INTO content_provider_refs (content_id, provider, entity_type, external_id, metadata)
          SELECT content_id, provider, entity_type, external_id, metadata
          FROM missing
          ON CONFLICT (provider, entity_type, external_id)
          DO UPDATE SET
            metadata = content_provider_refs.metadata || EXCLUDED.metadata,
            updated_at = now()
        )
        SELECT refs.content_id, refs.provider, refs.entity_type, refs.external_id, refs.metadata
        FROM incoming
        JOIN content_provider_refs refs
          ON refs.provider = incoming.provider
         AND refs.entity_type = incoming.entity_type
         AND refs.external_id = incoming.external_id
        ORDER BY incoming.ord ASC
      `,
      values,
    );

    return result.rows.map((row) => mapProviderRef(row));
  }

  async listProviderRefsByContentId(client: DbClient, contentId: string): Promise<ContentProviderRefRecord[]> {
    const result = await client.query(
      `
        SELECT content_id, provider, entity_type, external_id, metadata
        FROM content_provider_refs
        WHERE content_id = $1::uuid
        ORDER BY provider ASC, entity_type ASC, external_id ASC
      `,
      [contentId],
    );

    return result.rows.map((row) => mapProviderRef(row));
  }
}

function dedupeRefs(refs: ContentProviderRefInput[]): ContentProviderRefInput[] {
  const deduped = new Map<string, ContentProviderRefInput>();
  for (const ref of refs) {
    const key = `${ref.provider}:${ref.entityType}:${ref.externalId}`;
    if (!deduped.has(key)) {
      deduped.set(key, ref);
    }
  }
  return [...deduped.values()];
}
