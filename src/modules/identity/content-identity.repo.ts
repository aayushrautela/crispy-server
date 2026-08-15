import type { DbClient } from '../../lib/db.js';

export type ContentEntityType = 'movie' | 'show' | 'anime' | 'episode' | 'season' | 'person';

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

export type ContentItemRecord = {
  contentId: string;
  entityType: ContentEntityType;
};

export type ContentRelationshipType = 'series' | 'season';

export type ContentRelationshipInput = {
  childContentId: string;
  parentContentId: string;
  relationshipType: ContentRelationshipType;
  metadata?: Record<string, unknown>;
};

export type ContentRelationshipRecord = {
  childContentId: string;
  parentContentId: string;
  relationshipType: ContentRelationshipType;
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

function mapRelationship(row: Record<string, unknown>): ContentRelationshipRecord {
  return {
    childContentId: String(row.child_content_id),
    parentContentId: String(row.parent_content_id),
    relationshipType: String(row.relationship_type) as ContentRelationshipType,
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
          RETURNING content_id, provider, entity_type, external_id, metadata
        ),
        resolved_refs AS (
          SELECT content_id, provider, entity_type, external_id, metadata
          FROM inserted_refs
          UNION ALL
          SELECT refs.content_id, refs.provider, refs.entity_type, refs.external_id, refs.metadata
          FROM incoming
          JOIN content_provider_refs refs
            ON refs.provider = incoming.provider
           AND refs.entity_type = incoming.entity_type
           AND refs.external_id = incoming.external_id
          WHERE NOT EXISTS (
            SELECT 1
            FROM inserted_refs
            WHERE inserted_refs.provider = incoming.provider
              AND inserted_refs.entity_type = incoming.entity_type
              AND inserted_refs.external_id = incoming.external_id
          )
        )
        SELECT resolved_refs.content_id, resolved_refs.provider, resolved_refs.entity_type, resolved_refs.external_id, resolved_refs.metadata
        FROM incoming
        JOIN resolved_refs
          ON resolved_refs.provider = incoming.provider
         AND resolved_refs.entity_type = incoming.entity_type
         AND resolved_refs.external_id = incoming.external_id
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

  async findContentItemById(client: DbClient, contentId: string): Promise<ContentItemRecord | null> {
    const result = await client.query(
      `
        SELECT id, entity_type
        FROM content_items
        WHERE id = $1::uuid
        LIMIT 1
      `,
      [contentId],
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      contentId: String(row.id),
      entityType: String(row.entity_type) as ContentEntityType,
    };
  }

  async findContentItemsByIds(client: DbClient, contentIds: string[]): Promise<ContentItemRecord[]> {
    if (!contentIds.length) {
      return [];
    }

    const result = await client.query(
      `
        SELECT id, entity_type
        FROM content_items
        WHERE id = ANY($1::uuid[])
      `,
      [contentIds],
    );

    return result.rows.map((row) => ({
      contentId: String(row.id),
      entityType: String(row.entity_type) as ContentEntityType,
    }));
  }

  async listProviderRefsByContentIds(client: DbClient, contentIds: string[]): Promise<ContentProviderRefRecord[]> {
    if (!contentIds.length) {
      return [];
    }

    const result = await client.query(
      `
        SELECT content_id, provider, entity_type, external_id, metadata
        FROM content_provider_refs
        WHERE content_id = ANY($1::uuid[])
        ORDER BY provider ASC, entity_type ASC, external_id ASC
      `,
      [contentIds],
    );

    return result.rows.map((row) => mapProviderRef(row));
  }

  async findParentRelationshipsByChildIds(
    client: DbClient,
    childContentIds: string[],
    relationshipType: ContentRelationshipType,
  ): Promise<ContentRelationshipRecord[]> {
    if (!childContentIds.length) {
      return [];
    }

    const result = await client.query(
      `
        SELECT child_content_id, parent_content_id, relationship_type, metadata
        FROM content_item_relationships
        WHERE child_content_id = ANY($1::uuid[])
          AND relationship_type = $2::text
      `,
      [childContentIds, relationshipType],
    );

    return result.rows.map((row) => mapRelationship(row));
  }

  async upsertContentRelationship(
    client: DbClient,
    relationship: ContentRelationshipInput,
  ): Promise<ContentRelationshipRecord> {
    const [record] = await this.upsertContentRelationships(client, [relationship]);
    if (!record) {
      throw new Error('Unable to upsert content relationship.');
    }
    return record;
  }

  async upsertContentRelationships(
    client: DbClient,
    relationships: ContentRelationshipInput[],
  ): Promise<ContentRelationshipRecord[]> {
    const deduped = dedupeRelationships(relationships);
    if (!deduped.length) {
      return [];
    }

    const values: unknown[] = [];
    const tuples = deduped.map((relationship, index) => {
      const base = index * 5;
      values.push(
        index + 1,
        relationship.childContentId,
        relationship.parentContentId,
        relationship.relationshipType,
        JSON.stringify(relationship.metadata ?? {}),
      );
      return `($${base + 1}::integer, $${base + 2}::uuid, $${base + 3}::uuid, $${base + 4}::text, $${base + 5}::jsonb)`;
    });

    const result = await client.query(
      `
        WITH incoming(ord, child_content_id, parent_content_id, relationship_type, metadata) AS (
          VALUES ${tuples.join(', ')}
        ),
        upserted AS (
          INSERT INTO content_item_relationships (child_content_id, parent_content_id, relationship_type, metadata)
          SELECT child_content_id, parent_content_id, relationship_type, metadata
          FROM incoming
          ON CONFLICT (child_content_id, relationship_type)
          DO UPDATE SET
            parent_content_id = EXCLUDED.parent_content_id,
            metadata = content_item_relationships.metadata || EXCLUDED.metadata,
            updated_at = now()
          RETURNING child_content_id, parent_content_id, relationship_type, metadata
        )
        SELECT upserted.child_content_id, upserted.parent_content_id, upserted.relationship_type, upserted.metadata
        FROM incoming
        JOIN upserted
          ON upserted.child_content_id = incoming.child_content_id
         AND upserted.relationship_type = incoming.relationship_type
        ORDER BY incoming.ord ASC
      `,
      values,
    );

    return result.rows.map((row) => mapRelationship(row));
  }

  async findParentRelationship(
    client: DbClient,
    childContentId: string,
    relationshipType: ContentRelationshipType,
  ): Promise<ContentRelationshipRecord | null> {
    const result = await client.query(
      `
        SELECT child_content_id, parent_content_id, relationship_type, metadata
        FROM content_item_relationships
        WHERE child_content_id = $1::uuid
          AND relationship_type = $2::text
        LIMIT 1
      `,
      [childContentId, relationshipType],
    );

    const row = result.rows[0];
    return row ? mapRelationship(row) : null;
  }

  async listParentRelationships(
    client: DbClient,
    childContentId: string,
    relationshipTypes?: ContentRelationshipType[],
  ): Promise<ContentRelationshipRecord[]> {
    const result = await client.query(
      `
        SELECT child_content_id, parent_content_id, relationship_type, metadata
        FROM content_item_relationships
        WHERE child_content_id = $1::uuid
          AND ($2::text[] IS NULL OR relationship_type = ANY($2::text[]))
        ORDER BY relationship_type ASC, parent_content_id ASC
      `,
      [childContentId, relationshipTypes?.length ? relationshipTypes : null],
    );

    return result.rows.map((row) => mapRelationship(row));
  }

  async listParentRelationshipsBatch(
    client: DbClient,
    childContentIds: string[],
    relationshipTypes?: ContentRelationshipType[],
  ): Promise<ContentRelationshipRecord[]> {
    if (!childContentIds.length) {
      return [];
    }

    const result = await client.query(
      `
        SELECT child_content_id, parent_content_id, relationship_type, metadata
        FROM content_item_relationships
        WHERE child_content_id = ANY($1::uuid[])
          AND ($2::text[] IS NULL OR relationship_type = ANY($2::text[]))
        ORDER BY child_content_id ASC, relationship_type ASC, parent_content_id ASC
      `,
      [childContentIds, relationshipTypes?.length ? relationshipTypes : null],
    );

    return result.rows.map((row) => mapRelationship(row));
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

function dedupeRelationships(relationships: ContentRelationshipInput[]): ContentRelationshipInput[] {
  const deduped = new Map<string, ContentRelationshipInput>();
  for (const relationship of relationships) {
    const key = `${relationship.childContentId}:${relationship.relationshipType}`;
    deduped.set(key, relationship);
  }
  return [...deduped.values()];
}
