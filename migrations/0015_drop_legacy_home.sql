-- Drop the legacy per-locale homescreen subsystem.
--
-- The unified home pipeline (migrations/0014) replaced homescreen.* with the
-- source-tagged recommendation_active_lists / recommendation_list_versions
-- tables plus home.fallback_list_templates. These legacy tables are now
-- orphaned (no code references them after the admin UI + routes were removed).
--
-- NOTE: recommendation_snapshots is intentionally retained; the legacy reco
-- generation path still reads/writes it and is out of scope for this migration.

DROP TABLE IF EXISTS homescreen.default_snapshots;
DROP TABLE IF EXISTS homescreen.trakt_imports;
DROP TABLE IF EXISTS homescreen.collections;
DROP TABLE IF EXISTS homescreen.templates;
DROP SCHEMA IF EXISTS homescreen;
