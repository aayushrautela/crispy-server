-- Seed default-home pill templates (shared snapshot, English).
--
-- Pills are categoryTabs sections fed by the new TMDB sources:
--   tmdb.trending-person  -> trending actor / actress + their filmography
--   tmdb.new-this-week    -> movies now playing / shows premiered this week
--   tmdb.genre-fresh      -> recent popular movies from a genre picked at
--                            random per daily run (pick 1 and 2 read distinct
--                            slots of a day-seeded shuffle of the curated pool)
--
-- The template titles are fallbacks; trending-person and genre-fresh override
-- the section title at runtime with the picked person / genre.

INSERT INTO home.default_list_templates (list_key, section_type, title, subtitle, rank, source_id, source_config, is_active, created_by)
VALUES
  ('tmdb-trending-actor',   'categoryTabs', 'Trending Actor',   'Trending today', 100, 'tmdb.trending-person', '{"gender":"actor"}'::jsonb,    true, 'seed'),
  ('tmdb-trending-actress', 'categoryTabs', 'Trending Actress', 'Trending today', 110, 'tmdb.trending-person', '{"gender":"actress"}'::jsonb,  true, 'seed'),
  ('tmdb-new-movie',        'categoryTabs', 'New This Week',        NULL,         120, 'tmdb.new-this-week',   '{"mediaType":"movie"}'::jsonb, true, 'seed'),
  ('tmdb-new-show',         'categoryTabs', 'New Shows This Week',  NULL,         130, 'tmdb.new-this-week',   '{"mediaType":"tv"}'::jsonb,    true, 'seed'),
  ('tmdb-genre-fresh-1',    'categoryTabs', 'Fresh Picks',          'Updated daily', 140, 'tmdb.genre-fresh',  '{"pick":1}'::jsonb,            true, 'seed'),
  ('tmdb-genre-fresh-2',    'categoryTabs', 'Fresh Picks 2',        'Updated daily', 150, 'tmdb.genre-fresh',  '{"pick":2}'::jsonb,            true, 'seed')
ON CONFLICT (list_key) DO NOTHING;
