-- Identity v2 hard-cutoff migration.
-- Converts authoritative user-state and rebuildable cache identity storage from
-- legacy media-key text values to internal content_items.id UUIDs.

CREATE SCHEMA IF NOT EXISTS ops;

CREATE TABLE IF NOT EXISTS public.content_item_relationships (
  child_content_id uuid NOT NULL REFERENCES public.content_items(id) ON DELETE CASCADE,
  parent_content_id uuid NOT NULL REFERENCES public.content_items(id) ON DELETE CASCADE,
  relationship_type text NOT NULL CHECK (relationship_type IN ('series', 'season')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (child_content_id, relationship_type)
);

CREATE INDEX IF NOT EXISTS idx_content_item_relationships_parent_type
  ON public.content_item_relationships (parent_content_id, relationship_type);

COMMENT ON TABLE public.content_item_relationships IS 'Canonical parent relationships between content_items, e.g. episode to series/season and season to series.';
COMMENT ON COLUMN public.content_item_relationships.child_content_id IS 'Child content_items.id.';
COMMENT ON COLUMN public.content_item_relationships.parent_content_id IS 'Parent content_items.id.';
COMMENT ON COLUMN public.content_item_relationships.relationship_type IS 'Relationship kind. series = series/show parent; season = season parent.';
COMMENT ON COLUMN public.content_item_relationships.metadata IS 'Deterministic provider metadata used when materializing the relationship.';

CREATE TABLE IF NOT EXISTS ops.identity_v2_migration_audit (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  migration text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info', 'warning', 'error')),
  category text NOT NULL,
  table_name text NOT NULL,
  primary_key jsonb NOT NULL DEFAULT '{}'::jsonb,
  legacy_key text NULL,
  reason text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE ops.identity_v2_migration_audit IS 'Identity v2 cutover audit evidence for unresolved legacy media-key mappings, duplicate UUID mappings, and non-authoritative cache cleanup.';

DELETE FROM ops.identity_v2_migration_audit
WHERE migration = '0070_identity_v2_item_ids';

CREATE OR REPLACE FUNCTION ops.identity_v2_parse_media_key(p_media_key text)
RETURNS TABLE (
  media_key text,
  provider text,
  media_type text,
  entity_type text,
  external_id text,
  parent_external_id text,
  season_number integer,
  episode_number integer
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  parts text[];
BEGIN
  IF p_media_key IS NULL OR btrim(p_media_key) = '' THEN
    RETURN;
  END IF;

  parts := string_to_array(p_media_key, ':');

  IF cardinality(parts) = 3
     AND parts[2] = 'tmdb'
     AND parts[1] IN ('movie', 'show')
     AND btrim(parts[3]) <> '' THEN
    RETURN QUERY SELECT p_media_key, parts[2], parts[1], parts[1], parts[3], NULL::text, NULL::integer, NULL::integer;
    RETURN;
  END IF;

  IF cardinality(parts) = 4
     AND parts[1] = 'season'
     AND parts[2] = 'tmdb'
     AND btrim(parts[3]) <> ''
     AND parts[4] ~ '^[0-9]+$' THEN
    RETURN QUERY SELECT p_media_key, parts[2], parts[1], 'season', parts[3] || ':s' || parts[4], parts[3], parts[4]::integer, NULL::integer;
    RETURN;
  END IF;

  IF cardinality(parts) = 5
     AND parts[1] = 'episode'
     AND parts[2] = 'tmdb'
     AND btrim(parts[3]) <> ''
     AND parts[4] ~ '^[0-9]+$'
     AND parts[5] ~ '^[1-9][0-9]*$' THEN
    RETURN QUERY SELECT p_media_key, parts[2], parts[1], 'episode', parts[3] || ':s' || parts[4] || ':e' || parts[5], parts[3], parts[4]::integer, parts[5]::integer;
    RETURN;
  END IF;
END;
$$;

ALTER TABLE user_state.watch_events
  ADD COLUMN IF NOT EXISTS item_id uuid,
  ADD COLUMN IF NOT EXISTS title_item_id uuid;

ALTER TABLE user_state.playback_progress
  ADD COLUMN IF NOT EXISTS title_item_id uuid,
  ADD COLUMN IF NOT EXISTS playable_item_id uuid;

ALTER TABLE user_state.media_watch_summary
  ADD COLUMN IF NOT EXISTS item_id uuid,
  ADD COLUMN IF NOT EXISTS title_item_id uuid;

ALTER TABLE user_state.watch_sessions
  ADD COLUMN IF NOT EXISTS title_item_id uuid;

ALTER TABLE user_state.profile_list_items
  ADD COLUMN IF NOT EXISTS item_id uuid;

ALTER TABLE user_state.profile_ratings
  ADD COLUMN IF NOT EXISTS item_id uuid;

ALTER TABLE public.watch_media_card_cache
  ADD COLUMN IF NOT EXISTS item_id uuid;

ALTER TABLE recommendation.recommendation_list_items
  ADD COLUMN IF NOT EXISTS item_id uuid;

ALTER TABLE read_model.profile_episodic_follow_state
  ADD COLUMN IF NOT EXISTS next_episode_item_id uuid;

ALTER TABLE public.profile_episodic_follow_state
  ADD COLUMN IF NOT EXISTS next_episode_item_id uuid;

-- Materialize every deterministic TMDB item reference required by existing rows.
WITH legacy_keys(media_key) AS (
  SELECT media_key FROM user_state.watch_events
  UNION SELECT title_media_key FROM user_state.watch_events
  UNION SELECT title_media_key FROM user_state.playback_progress
  UNION SELECT playable_media_key FROM user_state.playback_progress
  UNION SELECT media_key FROM user_state.media_watch_summary
  UNION SELECT title_media_key FROM user_state.media_watch_summary
  UNION SELECT title_media_key FROM user_state.watch_sessions
  UNION SELECT media_key FROM user_state.profile_list_items
  UNION SELECT media_key FROM user_state.profile_ratings
  UNION SELECT media_key FROM public.watch_media_card_cache
  UNION SELECT media_key FROM recommendation.recommendation_list_items WHERE media_key IS NOT NULL
  UNION SELECT title_media_key FROM read_model.profile_episodic_follow_state
  UNION SELECT next_episode_media_key FROM read_model.profile_episodic_follow_state WHERE next_episode_media_key IS NOT NULL
  UNION SELECT title_media_key FROM public.profile_episodic_follow_state
  UNION SELECT next_episode_media_key FROM public.profile_episodic_follow_state WHERE next_episode_media_key IS NOT NULL
),
parsed AS (
  SELECT DISTINCT parsed.provider,
                  parsed.media_type,
                  parsed.entity_type,
                  parsed.external_id,
                  parsed.parent_external_id,
                  parsed.season_number,
                  parsed.episode_number
  FROM legacy_keys
  CROSS JOIN LATERAL ops.identity_v2_parse_media_key(legacy_keys.media_key) parsed
),
refs AS (
  SELECT provider,
         entity_type,
         external_id,
         jsonb_strip_nulls(jsonb_build_object(
           'provider', provider,
           'legacyMediaType', media_type,
           'parentProviderId', parent_external_id,
           'seasonNumber', season_number,
           'episodeNumber', episode_number,
           'showTmdbId', CASE WHEN parent_external_id ~ '^[1-9][0-9]*$' THEN parent_external_id::integer ELSE NULL END,
           'tmdbId', CASE WHEN media_type IN ('movie', 'show') AND external_id ~ '^[1-9][0-9]*$' THEN external_id::integer ELSE NULL END
         )) AS metadata
  FROM parsed
  UNION ALL
  SELECT provider,
         'show' AS entity_type,
         parent_external_id AS external_id,
         jsonb_strip_nulls(jsonb_build_object(
           'provider', provider,
           'providerId', parent_external_id,
           'tmdbId', CASE WHEN parent_external_id ~ '^[1-9][0-9]*$' THEN parent_external_id::integer ELSE NULL END
         )) AS metadata
  FROM parsed
  WHERE media_type IN ('season', 'episode')
    AND parent_external_id IS NOT NULL
  UNION ALL
  SELECT provider,
         'season' AS entity_type,
         parent_external_id || ':s' || season_number::text AS external_id,
         jsonb_strip_nulls(jsonb_build_object(
           'provider', provider,
           'parentMediaType', 'show',
           'parentProviderId', parent_external_id,
           'seasonNumber', season_number,
           'showTmdbId', CASE WHEN parent_external_id ~ '^[1-9][0-9]*$' THEN parent_external_id::integer ELSE NULL END
         )) AS metadata
  FROM parsed
  WHERE media_type = 'episode'
    AND parent_external_id IS NOT NULL
    AND season_number IS NOT NULL
),
deduped_refs AS (
  SELECT DISTINCT ON (provider, entity_type, external_id)
         provider,
         entity_type,
         external_id,
         metadata
  FROM refs
  ORDER BY provider, entity_type, external_id, metadata::text DESC
),
missing_refs AS (
  SELECT deduped_refs.*, gen_random_uuid() AS content_id
  FROM deduped_refs
  LEFT JOIN public.content_provider_refs existing
    ON existing.provider = deduped_refs.provider
   AND existing.entity_type = deduped_refs.entity_type
   AND existing.external_id = deduped_refs.external_id
  WHERE existing.content_id IS NULL
),
inserted_items AS (
  INSERT INTO public.content_items (id, entity_type)
  SELECT content_id, entity_type
  FROM missing_refs
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
INSERT INTO public.content_provider_refs (content_id, provider, entity_type, external_id, metadata)
SELECT content_id, provider, entity_type, external_id, metadata
FROM missing_refs
ON CONFLICT (provider, entity_type, external_id)
DO UPDATE SET
  metadata = public.content_provider_refs.metadata || EXCLUDED.metadata,
  updated_at = now();

-- Materialize deterministic series/season parent relationships from legacy episode and season keys.
WITH legacy_keys(media_key) AS (
  SELECT media_key FROM user_state.watch_events
  UNION SELECT title_media_key FROM user_state.watch_events
  UNION SELECT title_media_key FROM user_state.playback_progress
  UNION SELECT playable_media_key FROM user_state.playback_progress
  UNION SELECT media_key FROM user_state.media_watch_summary
  UNION SELECT title_media_key FROM user_state.media_watch_summary
  UNION SELECT title_media_key FROM user_state.watch_sessions
  UNION SELECT media_key FROM user_state.profile_list_items
  UNION SELECT media_key FROM user_state.profile_ratings
  UNION SELECT media_key FROM public.watch_media_card_cache
  UNION SELECT media_key FROM recommendation.recommendation_list_items WHERE media_key IS NOT NULL
  UNION SELECT title_media_key FROM read_model.profile_episodic_follow_state
  UNION SELECT next_episode_media_key FROM read_model.profile_episodic_follow_state WHERE next_episode_media_key IS NOT NULL
  UNION SELECT title_media_key FROM public.profile_episodic_follow_state
  UNION SELECT next_episode_media_key FROM public.profile_episodic_follow_state WHERE next_episode_media_key IS NOT NULL
),
parsed AS (
  SELECT DISTINCT parsed.*
  FROM legacy_keys
  CROSS JOIN LATERAL ops.identity_v2_parse_media_key(legacy_keys.media_key) parsed
),
relationship_rows AS (
  SELECT child_ref.content_id AS child_content_id,
         parent_ref.content_id AS parent_content_id,
         'series'::text AS relationship_type,
         jsonb_strip_nulls(jsonb_build_object(
           'provider', parsed.provider,
           'parentMediaType', 'show',
           'parentProviderId', parsed.parent_external_id,
           'seasonNumber', parsed.season_number,
           'episodeNumber', parsed.episode_number
         )) AS metadata
  FROM parsed
  JOIN public.content_provider_refs child_ref
    ON child_ref.provider = parsed.provider
   AND child_ref.entity_type = parsed.entity_type
   AND child_ref.external_id = parsed.external_id
  JOIN public.content_provider_refs parent_ref
    ON parent_ref.provider = parsed.provider
   AND parent_ref.entity_type = 'show'
   AND parent_ref.external_id = parsed.parent_external_id
  WHERE parsed.media_type IN ('season', 'episode')
  UNION ALL
  SELECT child_ref.content_id AS child_content_id,
         season_ref.content_id AS parent_content_id,
         'season'::text AS relationship_type,
         jsonb_strip_nulls(jsonb_build_object(
           'provider', parsed.provider,
           'parentMediaType', 'show',
           'parentProviderId', parsed.parent_external_id,
           'seasonNumber', parsed.season_number,
           'episodeNumber', parsed.episode_number
         )) AS metadata
  FROM parsed
  JOIN public.content_provider_refs child_ref
    ON child_ref.provider = parsed.provider
   AND child_ref.entity_type = 'episode'
   AND child_ref.external_id = parsed.external_id
  JOIN public.content_provider_refs season_ref
    ON season_ref.provider = parsed.provider
   AND season_ref.entity_type = 'season'
   AND season_ref.external_id = parsed.parent_external_id || ':s' || parsed.season_number::text
  WHERE parsed.media_type = 'episode'
)
INSERT INTO public.content_item_relationships (child_content_id, parent_content_id, relationship_type, metadata)
SELECT DISTINCT ON (child_content_id, relationship_type)
       child_content_id,
       parent_content_id,
       relationship_type,
       metadata
FROM relationship_rows
ORDER BY child_content_id, relationship_type, parent_content_id
ON CONFLICT (child_content_id, relationship_type)
DO UPDATE SET
  parent_content_id = EXCLUDED.parent_content_id,
  metadata = public.content_item_relationships.metadata || EXCLUDED.metadata,
  updated_at = now();

-- Backfill authoritative user-state UUID columns.
UPDATE user_state.watch_events target
SET item_id = (
      SELECT refs.content_id
      FROM ops.identity_v2_parse_media_key(target.media_key) parsed
      JOIN public.content_provider_refs refs
        ON refs.provider = parsed.provider
       AND refs.entity_type = parsed.entity_type
       AND refs.external_id = parsed.external_id
    ),
    title_item_id = (
      SELECT refs.content_id
      FROM ops.identity_v2_parse_media_key(target.title_media_key) parsed
      JOIN public.content_provider_refs refs
        ON refs.provider = parsed.provider
       AND refs.entity_type = parsed.entity_type
       AND refs.external_id = parsed.external_id
    )
WHERE target.item_id IS NULL
   OR target.title_item_id IS NULL;

UPDATE user_state.playback_progress target
SET title_item_id = (
      SELECT refs.content_id
      FROM ops.identity_v2_parse_media_key(target.title_media_key) parsed
      JOIN public.content_provider_refs refs
        ON refs.provider = parsed.provider
       AND refs.entity_type = parsed.entity_type
       AND refs.external_id = parsed.external_id
    ),
    playable_item_id = (
      SELECT refs.content_id
      FROM ops.identity_v2_parse_media_key(target.playable_media_key) parsed
      JOIN public.content_provider_refs refs
        ON refs.provider = parsed.provider
       AND refs.entity_type = parsed.entity_type
       AND refs.external_id = parsed.external_id
    )
WHERE target.title_item_id IS NULL
   OR target.playable_item_id IS NULL;

UPDATE user_state.media_watch_summary target
SET item_id = (
      SELECT refs.content_id
      FROM ops.identity_v2_parse_media_key(target.media_key) parsed
      JOIN public.content_provider_refs refs
        ON refs.provider = parsed.provider
       AND refs.entity_type = parsed.entity_type
       AND refs.external_id = parsed.external_id
    ),
    title_item_id = (
      SELECT refs.content_id
      FROM ops.identity_v2_parse_media_key(target.title_media_key) parsed
      JOIN public.content_provider_refs refs
        ON refs.provider = parsed.provider
       AND refs.entity_type = parsed.entity_type
       AND refs.external_id = parsed.external_id
    )
WHERE target.item_id IS NULL
   OR target.title_item_id IS NULL;

UPDATE user_state.watch_sessions target
SET title_item_id = (
      SELECT refs.content_id
      FROM ops.identity_v2_parse_media_key(target.title_media_key) parsed
      JOIN public.content_provider_refs refs
        ON refs.provider = parsed.provider
       AND refs.entity_type = parsed.entity_type
       AND refs.external_id = parsed.external_id
    )
WHERE target.title_item_id IS NULL;

UPDATE user_state.profile_list_items target
SET item_id = (
      SELECT refs.content_id
      FROM ops.identity_v2_parse_media_key(target.media_key) parsed
      JOIN public.content_provider_refs refs
        ON refs.provider = parsed.provider
       AND refs.entity_type = parsed.entity_type
       AND refs.external_id = parsed.external_id
    )
WHERE target.item_id IS NULL;

UPDATE user_state.profile_ratings target
SET item_id = (
      SELECT refs.content_id
      FROM ops.identity_v2_parse_media_key(target.media_key) parsed
      JOIN public.content_provider_refs refs
        ON refs.provider = parsed.provider
       AND refs.entity_type = parsed.entity_type
       AND refs.external_id = parsed.external_id
    )
WHERE target.item_id IS NULL;

-- Backfill rebuildable cache/read-model UUID columns.
UPDATE public.watch_media_card_cache target
SET item_id = (
      SELECT refs.content_id
      FROM ops.identity_v2_parse_media_key(target.media_key) parsed
      JOIN public.content_provider_refs refs
        ON refs.provider = parsed.provider
       AND refs.entity_type = parsed.entity_type
       AND refs.external_id = parsed.external_id
    )
WHERE target.item_id IS NULL;

UPDATE recommendation.recommendation_list_items target
SET item_id = (
      SELECT refs.content_id
      FROM ops.identity_v2_parse_media_key(target.media_key) parsed
      JOIN public.content_provider_refs refs
        ON refs.provider = parsed.provider
       AND refs.entity_type = parsed.entity_type
       AND refs.external_id = parsed.external_id
    )
WHERE target.media_key IS NOT NULL
  AND target.item_id IS NULL;

UPDATE read_model.profile_episodic_follow_state target
SET next_episode_item_id = (
      SELECT refs.content_id
      FROM ops.identity_v2_parse_media_key(target.next_episode_media_key) parsed
      JOIN public.content_provider_refs refs
        ON refs.provider = parsed.provider
       AND refs.entity_type = parsed.entity_type
       AND refs.external_id = parsed.external_id
    )
WHERE target.next_episode_media_key IS NOT NULL
  AND target.next_episode_item_id IS NULL;

UPDATE public.profile_episodic_follow_state target
SET next_episode_item_id = (
      SELECT refs.content_id
      FROM ops.identity_v2_parse_media_key(target.next_episode_media_key) parsed
      JOIN public.content_provider_refs refs
        ON refs.provider = parsed.provider
       AND refs.entity_type = parsed.entity_type
       AND refs.external_id = parsed.external_id
    )
WHERE target.next_episode_media_key IS NOT NULL
  AND target.next_episode_item_id IS NULL;

-- Authoritative unresolved rows block the destructive cutoff.
INSERT INTO ops.identity_v2_migration_audit (migration, severity, category, table_name, primary_key, legacy_key, reason, details)
SELECT '0070_identity_v2_item_ids', 'error', 'authoritative_unresolved', 'user_state.watch_events',
       jsonb_build_object('id', id), media_key,
       'watch_events.media_key could not be deterministically mapped to content_items.id',
       jsonb_build_object('column', 'media_key', 'media_type', media_type)
FROM user_state.watch_events
WHERE item_id IS NULL;

INSERT INTO ops.identity_v2_migration_audit (migration, severity, category, table_name, primary_key, legacy_key, reason, details)
SELECT '0070_identity_v2_item_ids', 'error', 'authoritative_unresolved', 'user_state.watch_events',
       jsonb_build_object('id', id), title_media_key,
       'watch_events.title_media_key could not be deterministically mapped to content_items.id',
       jsonb_build_object('column', 'title_media_key', 'media_type', media_type)
FROM user_state.watch_events
WHERE title_item_id IS NULL;

INSERT INTO ops.identity_v2_migration_audit (migration, severity, category, table_name, primary_key, legacy_key, reason, details)
SELECT '0070_identity_v2_item_ids', 'error', 'authoritative_unresolved', 'user_state.playback_progress',
       jsonb_build_object('profile_id', profile_id, 'title_media_key', title_media_key), title_media_key,
       'playback_progress.title_media_key could not be deterministically mapped to content_items.id',
       jsonb_build_object('column', 'title_media_key', 'media_type', media_type)
FROM user_state.playback_progress
WHERE title_item_id IS NULL;

INSERT INTO ops.identity_v2_migration_audit (migration, severity, category, table_name, primary_key, legacy_key, reason, details)
SELECT '0070_identity_v2_item_ids', 'error', 'authoritative_unresolved', 'user_state.playback_progress',
       jsonb_build_object('profile_id', profile_id, 'title_media_key', title_media_key), playable_media_key,
       'playback_progress.playable_media_key could not be deterministically mapped to content_items.id',
       jsonb_build_object('column', 'playable_media_key', 'media_type', media_type)
FROM user_state.playback_progress
WHERE playable_item_id IS NULL;

INSERT INTO ops.identity_v2_migration_audit (migration, severity, category, table_name, primary_key, legacy_key, reason, details)
SELECT '0070_identity_v2_item_ids', 'error', 'authoritative_unresolved', 'user_state.media_watch_summary',
       jsonb_build_object('profile_id', profile_id, 'media_key', media_key), media_key,
       'media_watch_summary.media_key could not be deterministically mapped to content_items.id',
       jsonb_build_object('column', 'media_key', 'media_type', media_type)
FROM user_state.media_watch_summary
WHERE item_id IS NULL;

INSERT INTO ops.identity_v2_migration_audit (migration, severity, category, table_name, primary_key, legacy_key, reason, details)
SELECT '0070_identity_v2_item_ids', 'error', 'authoritative_unresolved', 'user_state.media_watch_summary',
       jsonb_build_object('profile_id', profile_id, 'media_key', media_key), title_media_key,
       'media_watch_summary.title_media_key could not be deterministically mapped to content_items.id',
       jsonb_build_object('column', 'title_media_key', 'media_type', media_type)
FROM user_state.media_watch_summary
WHERE title_item_id IS NULL;

INSERT INTO ops.identity_v2_migration_audit (migration, severity, category, table_name, primary_key, legacy_key, reason, details)
SELECT '0070_identity_v2_item_ids', 'error', 'authoritative_unresolved', 'user_state.watch_sessions',
       jsonb_build_object('id', id), title_media_key,
       'watch_sessions.title_media_key could not be deterministically mapped to content_items.id',
       jsonb_build_object('column', 'title_media_key', 'media_type', media_type)
FROM user_state.watch_sessions
WHERE title_item_id IS NULL;

INSERT INTO ops.identity_v2_migration_audit (migration, severity, category, table_name, primary_key, legacy_key, reason, details)
SELECT '0070_identity_v2_item_ids', 'error', 'authoritative_unresolved', 'user_state.profile_list_items',
       jsonb_build_object('profile_id', profile_id, 'list_kind', list_kind, 'media_key', media_key), media_key,
       'profile_list_items.media_key could not be deterministically mapped to content_items.id',
       jsonb_build_object('column', 'media_key', 'media_type', media_type)
FROM user_state.profile_list_items
WHERE item_id IS NULL;

INSERT INTO ops.identity_v2_migration_audit (migration, severity, category, table_name, primary_key, legacy_key, reason, details)
SELECT '0070_identity_v2_item_ids', 'error', 'authoritative_unresolved', 'user_state.profile_ratings',
       jsonb_build_object('profile_id', profile_id, 'media_key', media_key), media_key,
       'profile_ratings.media_key could not be deterministically mapped to content_items.id',
       jsonb_build_object('column', 'media_key', 'media_type', media_type)
FROM user_state.profile_ratings
WHERE item_id IS NULL;

-- Authoritative duplicate UUID mappings would make old PKs non-losslessly collapse.
WITH duplicate_groups AS (
  SELECT profile_id, title_item_id, count(*) AS row_count, jsonb_agg(title_media_key ORDER BY title_media_key) AS legacy_keys
  FROM user_state.playback_progress
  GROUP BY profile_id, title_item_id
  HAVING count(*) > 1
)
INSERT INTO ops.identity_v2_migration_audit (migration, severity, category, table_name, primary_key, reason, details)
SELECT '0070_identity_v2_item_ids', 'error', 'authoritative_duplicate_mapping', 'user_state.playback_progress',
       jsonb_build_object('profile_id', profile_id, 'title_item_id', title_item_id),
       'Multiple playback_progress rows map to the same final (profile_id, title_item_id) key',
       jsonb_build_object('row_count', row_count, 'legacy_keys', legacy_keys)
FROM duplicate_groups;

WITH duplicate_groups AS (
  SELECT profile_id, item_id, count(*) AS row_count, jsonb_agg(media_key ORDER BY media_key) AS legacy_keys
  FROM user_state.media_watch_summary
  GROUP BY profile_id, item_id
  HAVING count(*) > 1
)
INSERT INTO ops.identity_v2_migration_audit (migration, severity, category, table_name, primary_key, reason, details)
SELECT '0070_identity_v2_item_ids', 'error', 'authoritative_duplicate_mapping', 'user_state.media_watch_summary',
       jsonb_build_object('profile_id', profile_id, 'item_id', item_id),
       'Multiple media_watch_summary rows map to the same final (profile_id, item_id) key',
       jsonb_build_object('row_count', row_count, 'legacy_keys', legacy_keys)
FROM duplicate_groups;

WITH duplicate_groups AS (
  SELECT profile_id, list_kind, item_id, count(*) AS row_count, jsonb_agg(media_key ORDER BY media_key) AS legacy_keys
  FROM user_state.profile_list_items
  GROUP BY profile_id, list_kind, item_id
  HAVING count(*) > 1
)
INSERT INTO ops.identity_v2_migration_audit (migration, severity, category, table_name, primary_key, reason, details)
SELECT '0070_identity_v2_item_ids', 'error', 'authoritative_duplicate_mapping', 'user_state.profile_list_items',
       jsonb_build_object('profile_id', profile_id, 'list_kind', list_kind, 'item_id', item_id),
       'Multiple profile_list_items rows map to the same final (profile_id, list_kind, item_id) key',
       jsonb_build_object('row_count', row_count, 'legacy_keys', legacy_keys)
FROM duplicate_groups;

WITH duplicate_groups AS (
  SELECT profile_id, item_id, count(*) AS row_count, jsonb_agg(media_key ORDER BY media_key) AS legacy_keys
  FROM user_state.profile_ratings
  GROUP BY profile_id, item_id
  HAVING count(*) > 1
)
INSERT INTO ops.identity_v2_migration_audit (migration, severity, category, table_name, primary_key, reason, details)
SELECT '0070_identity_v2_item_ids', 'error', 'authoritative_duplicate_mapping', 'user_state.profile_ratings',
       jsonb_build_object('profile_id', profile_id, 'item_id', item_id),
       'Multiple profile_ratings rows map to the same final (profile_id, item_id) key',
       jsonb_build_object('row_count', row_count, 'legacy_keys', legacy_keys)
FROM duplicate_groups;

DO $$
DECLARE
  blocker_count integer;
  blocker_detail text;
BEGIN
  SELECT count(*)
  INTO blocker_count
  FROM ops.identity_v2_migration_audit
  WHERE migration = '0070_identity_v2_item_ids'
    AND severity = 'error';

  IF blocker_count > 0 THEN
    SELECT jsonb_agg(sample_row)::text
    INTO blocker_detail
    FROM (
      SELECT table_name, primary_key, legacy_key, reason, details
      FROM ops.identity_v2_migration_audit
      WHERE migration = '0070_identity_v2_item_ids'
        AND severity = 'error'
      ORDER BY id
      LIMIT 20
    ) sample_row;

    RAISE EXCEPTION 'Identity v2 migration blocked: % authoritative row mapping errors. Resolve audit rows before destructive cutoff.', blocker_count
      USING DETAIL = COALESCE(blocker_detail, '[]');
  END IF;
END $$;

-- Cache/read-model rows are non-authoritative and can be regenerated. Audit, then remove only cache rows that cannot be keyed.
INSERT INTO ops.identity_v2_migration_audit (migration, severity, category, table_name, primary_key, legacy_key, reason, details)
SELECT '0070_identity_v2_item_ids', 'warning', 'cache_unresolved_dropped', 'public.watch_media_card_cache',
       jsonb_build_object('media_key', media_key, 'language', language), media_key,
       'watch_media_card_cache.media_key could not be deterministically mapped; cache row dropped',
       jsonb_build_object('media_type', media_type, 'language', language)
FROM public.watch_media_card_cache
WHERE item_id IS NULL;

DELETE FROM public.watch_media_card_cache
WHERE item_id IS NULL;

INSERT INTO ops.identity_v2_migration_audit (migration, severity, category, table_name, primary_key, legacy_key, reason, details)
SELECT '0070_identity_v2_item_ids', 'warning', 'read_model_unresolved_retained', 'recommendation.recommendation_list_items',
       jsonb_build_object('id', id), media_key,
       'recommendation_list_items.media_key could not be deterministically mapped; nullable item_id retained as NULL for later regeneration/resolution',
       jsonb_build_object('media_type', media_type, 'resolution_status', resolution_status)
FROM recommendation.recommendation_list_items
WHERE media_key IS NOT NULL
  AND item_id IS NULL;

INSERT INTO ops.identity_v2_migration_audit (migration, severity, category, table_name, primary_key, reason, details)
SELECT '0070_identity_v2_item_ids', 'warning', 'cache_duplicate_dropped', 'public.watch_media_card_cache',
       jsonb_build_object('item_id', item_id, 'language', language),
       'Multiple cache rows map to the same final (item_id, language) key; newest cache row retained',
       jsonb_build_object('row_count', count(*), 'legacy_keys', jsonb_agg(media_key ORDER BY updated_at DESC, media_key ASC))
FROM public.watch_media_card_cache
GROUP BY item_id, language
HAVING count(*) > 1;

WITH ranked AS (
  SELECT ctid,
         row_number() OVER (PARTITION BY item_id, language ORDER BY updated_at DESC, media_key ASC) AS row_rank
  FROM public.watch_media_card_cache
)
DELETE FROM public.watch_media_card_cache cache
USING ranked
WHERE cache.ctid = ranked.ctid
  AND ranked.row_rank > 1;

INSERT INTO ops.identity_v2_migration_audit (migration, severity, category, table_name, primary_key, legacy_key, reason, details)
SELECT '0070_identity_v2_item_ids', 'warning', 'read_model_unresolved_retained', 'read_model.profile_episodic_follow_state',
       jsonb_build_object('profile_id', profile_id, 'title_content_id', title_content_id), next_episode_media_key,
       'next_episode_media_key could not be deterministically mapped; nullable read-model next_episode_item_id retained as NULL',
       jsonb_build_object('next_episode_season_number', next_episode_season_number, 'next_episode_episode_number', next_episode_episode_number)
FROM read_model.profile_episodic_follow_state
WHERE next_episode_media_key IS NOT NULL
  AND next_episode_item_id IS NULL;

INSERT INTO ops.identity_v2_migration_audit (migration, severity, category, table_name, primary_key, legacy_key, reason, details)
SELECT '0070_identity_v2_item_ids', 'warning', 'read_model_unresolved_retained', 'public.profile_episodic_follow_state',
       jsonb_build_object('profile_id', profile_id, 'title_content_id', title_content_id), next_episode_media_key,
       'next_episode_media_key could not be deterministically mapped; nullable read-model next_episode_item_id retained as NULL',
       jsonb_build_object('next_episode_season_number', next_episode_season_number, 'next_episode_episode_number', next_episode_episode_number)
FROM public.profile_episodic_follow_state
WHERE next_episode_media_key IS NOT NULL
  AND next_episode_item_id IS NULL;

INSERT INTO ops.identity_v2_migration_audit (migration, severity, category, table_name, primary_key, reason, details)
SELECT '0070_identity_v2_item_ids', 'info', 'recommendation_snapshots_cleared', 'public.recommendation_snapshots',
       '{}'::jsonb,
       'Legacy recommendation snapshots cleared during Identity v2 cutover',
       jsonb_build_object('deleted_count', count(*))
FROM public.recommendation_snapshots;

DELETE FROM public.recommendation_snapshots;

-- Final hard-cutoff schema: enforce UUID columns, rebuild PKs/indexes, and remove legacy media-key identity columns.
ALTER TABLE user_state.watch_events
  ALTER COLUMN item_id SET NOT NULL,
  ALTER COLUMN title_item_id SET NOT NULL,
  ADD CONSTRAINT watch_events_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.content_items(id),
  ADD CONSTRAINT watch_events_title_item_id_fkey FOREIGN KEY (title_item_id) REFERENCES public.content_items(id);

DROP INDEX IF EXISTS user_state.idx_watch_events_profile_title;
DROP INDEX IF EXISTS user_state.idx_watch_events_profile_media;

CREATE INDEX idx_watch_events_profile_title_item
  ON user_state.watch_events (profile_id, title_item_id, occurred_at DESC);

CREATE INDEX idx_watch_events_profile_item
  ON user_state.watch_events (profile_id, item_id, occurred_at DESC);

ALTER TABLE user_state.watch_events
  DROP COLUMN media_key,
  DROP COLUMN title_media_key;

ALTER TABLE user_state.playback_progress
  ALTER COLUMN title_item_id SET NOT NULL,
  ALTER COLUMN playable_item_id SET NOT NULL,
  ADD CONSTRAINT playback_progress_title_item_id_fkey FOREIGN KEY (title_item_id) REFERENCES public.content_items(id),
  ADD CONSTRAINT playback_progress_playable_item_id_fkey FOREIGN KEY (playable_item_id) REFERENCES public.content_items(id);

ALTER TABLE user_state.playback_progress
  DROP CONSTRAINT playback_progress_pkey;

ALTER TABLE user_state.playback_progress
  ADD PRIMARY KEY (profile_id, title_item_id);

CREATE INDEX idx_playback_progress_playable_item
  ON user_state.playback_progress (profile_id, playable_item_id);

ALTER TABLE user_state.playback_progress
  DROP COLUMN title_media_key,
  DROP COLUMN playable_media_key;

ALTER TABLE user_state.media_watch_summary
  ALTER COLUMN item_id SET NOT NULL,
  ALTER COLUMN title_item_id SET NOT NULL,
  ADD CONSTRAINT media_watch_summary_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.content_items(id),
  ADD CONSTRAINT media_watch_summary_title_item_id_fkey FOREIGN KEY (title_item_id) REFERENCES public.content_items(id);

ALTER TABLE user_state.media_watch_summary
  DROP CONSTRAINT media_watch_summary_pkey;

ALTER TABLE user_state.media_watch_summary
  ADD PRIMARY KEY (profile_id, item_id);

DROP INDEX IF EXISTS user_state.idx_watch_summary_profile_title;

CREATE INDEX idx_watch_summary_profile_title_item
  ON user_state.media_watch_summary (profile_id, title_item_id);

ALTER TABLE user_state.media_watch_summary
  DROP COLUMN media_key,
  DROP COLUMN title_media_key;

ALTER TABLE user_state.watch_sessions
  ALTER COLUMN title_item_id SET NOT NULL,
  ADD CONSTRAINT watch_sessions_title_item_id_fkey FOREIGN KEY (title_item_id) REFERENCES public.content_items(id);

CREATE INDEX idx_watch_sessions_profile_title_item
  ON user_state.watch_sessions (profile_id, title_item_id, started_at DESC);

ALTER TABLE user_state.watch_sessions
  DROP COLUMN title_media_key;

ALTER TABLE user_state.profile_list_items
  ALTER COLUMN item_id SET NOT NULL,
  ADD CONSTRAINT profile_list_items_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.content_items(id);

ALTER TABLE user_state.profile_list_items
  DROP CONSTRAINT profile_list_items_pkey;

ALTER TABLE user_state.profile_list_items
  ADD PRIMARY KEY (profile_id, list_kind, item_id);

ALTER TABLE user_state.profile_list_items
  DROP COLUMN media_key;

ALTER TABLE user_state.profile_ratings
  ALTER COLUMN item_id SET NOT NULL,
  ADD CONSTRAINT profile_ratings_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.content_items(id);

ALTER TABLE user_state.profile_ratings
  DROP CONSTRAINT profile_ratings_pkey;

ALTER TABLE user_state.profile_ratings
  ADD PRIMARY KEY (profile_id, item_id);

ALTER TABLE user_state.profile_ratings
  DROP COLUMN media_key;

ALTER TABLE public.watch_media_card_cache
  ALTER COLUMN item_id SET NOT NULL,
  ADD CONSTRAINT watch_media_card_cache_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.content_items(id) ON DELETE CASCADE;

ALTER TABLE public.watch_media_card_cache
  DROP CONSTRAINT IF EXISTS watch_media_card_cache_pkey;

ALTER TABLE public.watch_media_card_cache
  ADD PRIMARY KEY (item_id, language);

ALTER TABLE public.watch_media_card_cache
  DROP COLUMN media_key;

ALTER TABLE recommendation.recommendation_list_items
  ADD CONSTRAINT recommendation_list_items_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.content_items(id);

DROP INDEX IF EXISTS recommendation.idx_recommendation_list_items_media_key;
DROP INDEX IF EXISTS public.idx_recommendation_list_items_media_key;

CREATE INDEX idx_recommendation_list_items_item_id
  ON recommendation.recommendation_list_items (item_id)
  WHERE item_id IS NOT NULL;

ALTER TABLE recommendation.recommendation_list_items
  DROP COLUMN media_key;

ALTER TABLE read_model.profile_episodic_follow_state
  ADD CONSTRAINT rm_profile_episodic_follow_next_episode_item_id_fkey
  FOREIGN KEY (next_episode_item_id) REFERENCES public.content_items(id);

DROP INDEX IF EXISTS read_model.idx_follow_profile_media_key;

ALTER TABLE read_model.profile_episodic_follow_state
  DROP COLUMN title_media_key,
  DROP COLUMN next_episode_media_key;

ALTER TABLE public.profile_episodic_follow_state
  ADD CONSTRAINT public_profile_episodic_follow_next_episode_item_id_fkey
  FOREIGN KEY (next_episode_item_id) REFERENCES public.content_items(id);

DROP INDEX IF EXISTS public.profile_episodic_follow_state_profile_media_key_idx;

ALTER TABLE public.profile_episodic_follow_state
  DROP COLUMN title_media_key,
  DROP COLUMN next_episode_media_key;

DROP FUNCTION ops.identity_v2_parse_media_key(text);
