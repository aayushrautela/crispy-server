-- Shared default home.
--
-- The per-profile fallback home is removed. Home storage keeps only the
-- profile-owned sources ('custom' and 'reco'); the deterministic default home
-- becomes a shared read artifact built from home.default_list_templates and
-- cached in Redis, never materialized into per-profile rows.
--
-- 1. Drop all per-profile fallback home data.
-- 2. Tighten the source CHECK constraints to ('custom', 'reco').
-- 3. Rename home.fallback_list_templates -> home.default_list_templates.
-- 4. Deactivate the 'fallback' app principal registered by 0022 (the in-process
--    writer is gone; nothing authenticates or writes as 'fallback').

DELETE FROM recommendation_active_lists WHERE source = 'fallback';
DELETE FROM recommendation_list_versions WHERE source = 'fallback';

ALTER TABLE recommendation_active_lists
  DROP CONSTRAINT IF EXISTS recommendation_active_lists_source_check;
ALTER TABLE recommendation_active_lists
  ADD CONSTRAINT recommendation_active_lists_source_check
  CHECK (source IN ('custom', 'reco'));

ALTER TABLE recommendation_list_versions
  DROP CONSTRAINT IF EXISTS recommendation_list_versions_source_check;
ALTER TABLE recommendation_list_versions
  ADD CONSTRAINT recommendation_list_versions_source_check
  CHECK (source IN ('custom', 'reco'));

-- Rename the template config table. It stays the source of rails for the
-- shared default-home builder; only the name changes.
ALTER TABLE home.fallback_list_templates RENAME TO default_list_templates;

ALTER TABLE home.default_list_templates
  RENAME CONSTRAINT fallback_list_templates_pkey TO default_list_templates_pkey;
ALTER TABLE home.default_list_templates
  RENAME CONSTRAINT fallback_list_templates_refresh_chk TO default_list_templates_refresh_chk;

ALTER INDEX home.home_fallback_tpl_mode_idx RENAME TO home_default_tpl_mode_idx;
ALTER INDEX home.home_fallback_tpl_refresh_idx RENAME TO home_default_tpl_refresh_idx;

-- Deactivate the fallback service principal.
UPDATE app_registry SET status = 'inactive', updated_at = now() WHERE app_id = 'fallback';
UPDATE app_scopes SET status = 'inactive' WHERE app_id = 'fallback';
DELETE FROM app_grants WHERE app_id = 'fallback';
DELETE FROM app_source_ownership WHERE app_id = 'fallback' AND source = 'fallback';
DELETE FROM app_rate_limit_policies WHERE app_id = 'fallback';
DELETE FROM app_keys WHERE app_id = 'fallback';
