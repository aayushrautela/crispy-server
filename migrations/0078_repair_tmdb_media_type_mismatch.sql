-- 0078_repair_tmdb_media_type_mismatch.sql
--
-- Summary persistence used a single media-type fallback for every payload, so
-- TMDB /search/tv and /discover/tv results — which carry no media_type field —
-- were written into tmdb_titles with media_type='movie' and their series tmdb
-- id. Those mislabeled rows made TV shows surface as "movies" in genre browse
-- (e.g. the Animated pill) and all-filter text search, and resolve under a
-- movie:tmdb:<showId> identity.
--
-- A row stored as a movie that carries first_air_date (a TV-only field) and no
-- release_date can only have come from a TV payload, so those rows are removed.
-- Child rows (translations, images, reviews) cascade via the
-- (media_type, tmdb_id) FK. Rows are a cache: the title is re-persisted under
-- the correct media_type the next time it is searched, browsed, or hydrated.
-- Idempotent — a second run deletes nothing.

DELETE FROM tmdb_titles t
WHERE t.media_type = 'movie'
  AND t.first_air_date IS NOT NULL
  AND t.release_date IS NULL;