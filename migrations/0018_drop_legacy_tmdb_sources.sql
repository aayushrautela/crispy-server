-- Retire the fragmented TMDB list sources and replace them with a single
-- tmdb.discover-filtered source (one source, all feeds + filters as selects).
--
-- Any templates still referencing the old source_ids are deleted; none are
-- re-pointed because the old config shapes do not map 1:1 to the new source.
--
-- We then reseed five canonical rails as 'auto' (locale-agnostic) so an empty
-- install renders a deterministic home without an admin touching anything.

DELETE FROM home.fallback_list_templates
WHERE source_id IN (
  'tmdb.trending',
  'tmdb.popular',
  'tmdb.top-rated',
  'tmdb.now-playing',
  'tmdb.airing-today',
  'tmdb.upcoming',
  'tmdb.discover-by-genre',
  'tmdb.list'
);

INSERT INTO home.fallback_list_templates (list_key, locale, locale_mode, section_type, title, subtitle, rank, source_id, source_config, is_active, created_by, updated_by)
VALUES
  ('trending-week',     'en', 'auto', 'heroCarousel', 'Trending This Week', NULL, 10, 'tmdb.discover-filtered', '{"feed":"trending-week","mediaType":"movie","genre":"","year":"","originalLanguage":"","sortBy":"popularity.desc","minRating":"","maxItems":20}'::jsonb, true, 'seed', 'seed'),
  ('trending-tv',       'en', 'auto', 'heroCarousel', 'Trending TV',        NULL, 20, 'tmdb.discover-filtered', '{"feed":"trending-week","mediaType":"tv","genre":"","year":"","originalLanguage":"","sortBy":"popularity.desc","minRating":"","maxItems":20}'::jsonb,  true, 'seed', 'seed'),
  ('popular-movies',    'en', 'auto', 'contentRail',  'Popular Movies',     NULL, 30, 'tmdb.discover-filtered', '{"feed":"popular","mediaType":"movie","genre":"","year":"","originalLanguage":"","sortBy":"popularity.desc","minRating":"","maxItems":40}'::jsonb,        true, 'seed', 'seed'),
  ('popular-shows',     'en', 'auto', 'contentRail',  'Popular Shows',      NULL, 40, 'tmdb.discover-filtered', '{"feed":"popular","mediaType":"tv","genre":"","year":"","originalLanguage":"","sortBy":"popularity.desc","minRating":"","maxItems":40}'::jsonb,           true, 'seed', 'seed'),
  ('new-releases',      'en', 'auto', 'contentRail',  'New This Week',      NULL, 50, 'tmdb.discover-filtered', '{"feed":"discover","mediaType":"movie","genre":"","year":"","originalLanguage":"","sortBy":"release_date.desc","minRating":5,"maxItems":40}'::jsonb, true, 'seed', 'seed'),
  ('continue-watching', 'en', 'auto', 'contentRail',  'Continue Watching',  NULL,  0, 'home.continue-watching', '{}'::jsonb, true, 'seed', 'seed')
ON CONFLICT (list_key) DO NOTHING;
