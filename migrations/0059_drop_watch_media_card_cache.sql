-- Phase 3 hard cutoff: watch_media_card_cache was a shadow metadata store
-- duplicating tmdb_titles. Watch reads now hydrate via MetadataCardService
-- at the route boundary, so this cache is no longer read or written.
DROP TABLE IF EXISTS watch_media_card_cache;
