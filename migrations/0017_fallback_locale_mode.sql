-- Locale-aware fallback rails.
--
-- Adds locale_mode so a single rail can serve every viewer locale ('auto'),
-- be pinned to English ('en'), or target one specific locale ('specific').
-- Replaces the per-locale duplicate seed rows from 0016 (which encoded the
-- display language by duplicating the whole rail) with one row per concept.
--
-- storage note: home.fallback_list_versions.locale keeps its column name but
-- now means "viewer-resolved locale" for auto rows (see 0018 comment). No
-- rename migration to avoid breaking readers; semantics documented in code.

-- Drop locale-scoped indexes that depend on the old (list_key, locale) PK.
DROP INDEX IF EXISTS home.home_fallback_tpl_locale_idx;
DROP INDEX IF EXISTS home.home_fallback_tpl_refresh_idx;

ALTER TABLE home.fallback_list_templates
  ADD COLUMN locale_mode text NOT NULL DEFAULT 'specific'
    CHECK (locale_mode IN ('auto', 'specific', 'en')),
  ADD COLUMN region_override text;

-- Collapse the old per-locale duplicates. 0016 seeded en/es/fr/de with identical
-- intent per locale. Keep exactly one row per list_key as 'auto'.
DELETE FROM home.fallback_list_templates WHERE locale IN ('es', 'fr', 'de');
UPDATE home.fallback_list_templates
  SET locale_mode = 'auto', locale = 'en'
  WHERE locale = 'en';

-- Replace the (list_key, locale) PK with a single row per conceptual rail.
ALTER TABLE home.fallback_list_templates DROP CONSTRAINT IF EXISTS fallback_list_templates_pkey;
ALTER TABLE home.fallback_list_templates ADD PRIMARY KEY (list_key);

-- Recreate indexes against the new shape.
CREATE INDEX home_fallback_tpl_mode_idx
  ON home.fallback_list_templates (locale_mode) WHERE is_active;
CREATE INDEX home_fallback_tpl_refresh_idx
  ON home.fallback_list_templates (refresh_minutes)
  WHERE refresh_minutes IS NOT NULL AND is_active;
