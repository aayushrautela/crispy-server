-- Retire the Trakt list-source mechanism for the default home and reseed the
-- trending/popular rails on the new TMDB sources.
--
-- The Trakt home feeds (trakt.trending, trakt.popular, trakt.anticipated, ...)
-- are gone from the list-source registry; the home screen no longer uses Trakt
-- (watch-history import and reviews/ratings are separate integrations and stay).
--
-- The six seeded Trakt rails are deleted. TMDB now backs trending and popular:
--   tmdb.trending -> Trending Movies (hero) / Trending Shows
--   tmdb.popular  -> Big Movies Right Now (popular movies) / Most-Watched Shows
--
-- "Popular in Your Region" and "Most Anticipated" have no TMDB equivalent and
-- are dropped entirely. The TMDB pills seeded in 0070 and any admin-added
-- MDBList collection rails are untouched.
--
-- The admin UI lists these new TMDB rails read-only (managed); they are not
-- admin-creatable from the Web UI.

DELETE FROM home.default_list_templates
WHERE source_id LIKE 'trakt.%';

INSERT INTO home.default_list_templates (list_key, section_type, title, subtitle, rank, source_id, source_config, is_active, created_by)
VALUES
  ('tmdb-trending-movie',   'heroCarousel', 'Trending Movies',      NULL, 10, 'tmdb.trending', '{"mediaType":"movie","timeWindow":"week"}'::jsonb, true, 'seed'),
  ('tmdb-trending-show',    'contentRail',  'Trending Shows',       NULL, 20, 'tmdb.trending', '{"mediaType":"tv","timeWindow":"week"}'::jsonb,    true, 'seed'),
  ('tmdb-popular-movie',    'contentRail',  'Big Movies Right Now', NULL, 30, 'tmdb.popular',  '{"mediaType":"movie"}'::jsonb,                     true, 'seed'),
  ('tmdb-popular-show',     'contentRail',  'Most-Watched Shows',   NULL, 40, 'tmdb.popular',  '{"mediaType":"tv"}'::jsonb,                        true, 'seed')
ON CONFLICT (list_key) DO NOTHING;