ALTER TABLE content_provider_refs DROP CONSTRAINT IF EXISTS content_provider_refs_content_id_fkey;
DROP TABLE IF EXISTS content_provider_refs;
DROP TABLE IF EXISTS content_items;

CREATE TABLE content_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type text NOT NULL CHECK (entity_type IN ('movie', 'show', 'anime', 'episode', 'season', 'person')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE content_provider_refs (
    content_id uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
    provider text NOT NULL,
    entity_type text NOT NULL CHECK (entity_type IN ('movie', 'show', 'anime', 'episode', 'season', 'person')),
    external_id text NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, entity_type, external_id)
);

CREATE INDEX idx_content_provider_refs_content_id
    ON content_provider_refs(content_id);

CREATE INDEX idx_content_items_entity_type_created
    ON content_items(entity_type, created_at DESC);
