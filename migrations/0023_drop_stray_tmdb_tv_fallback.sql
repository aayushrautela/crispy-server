-- Drop stray legacy fallback template that pointed at trakt.popular.
--
-- Background: migration 0018_drop_legacy_tmdb_sources.sql cleaned up the seed
-- rows that used the now-deleted legacy TMDB list sources, but the `tmdb--tv`
-- row slipped through (it was probably created manually before the cleanup
-- and pointed source_id at trakt.popular, which 0018 left untouched).
--
-- Trakt's /show/popular endpoint recently started returning HTTP 405, so the
-- admin UI sync for this template 500'd with trakt_request_failed_for_show_
-- popular. The template is a duplicate of the working `popular-shows` row
-- (which uses tmdb.discover-filtered, feed=popular, mediaType=tv) and the
-- list_key name (`tmdb--tv`) is misleading. Deleting it is the cleanest fix.

DELETE FROM home.fallback_list_templates WHERE list_key = 'tmdb--tv';
DELETE FROM home.fallback_list_versions  WHERE list_key = 'tmdb--tv';
