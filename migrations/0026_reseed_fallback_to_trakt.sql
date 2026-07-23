-- Replace all TMDB-backed fallback rails with Trakt-only sources.
-- TMDB list sources have been removed from the registry; Trakt now
-- provides trending, popular, anticipated, new-releases, calendar,
-- popular-by-region, and public-list (URL) feeds.

DELETE FROM home.fallback_list_templates
WHERE source_id LIKE 'tmdb.%'
   OR source_id LIKE 'home.%';

INSERT INTO home.fallback_list_templates (list_key, locale, locale_mode, section_type, title, subtitle, rank, source_id, source_config, is_active, created_by, updated_by)
VALUES
  ('trakt-trending-movie',     'en', 'auto', 'contentRail', 'Trending Movies',         NULL, 10, 'trakt.trending',          '{"mediaType":"movie"}'::jsonb,                    true, 'seed', 'seed'),
  ('trakt-trending-show',      'en', 'auto', 'contentRail', 'Trending Shows',          NULL, 20, 'trakt.trending',          '{"mediaType":"tv"}'::jsonb,                       true, 'seed', 'seed'),
  ('trakt-popular-movie',      'en', 'auto', 'contentRail', 'Popular Movies',          NULL, 30, 'trakt.popular',           '{"mediaType":"movie"}'::jsonb,                    true, 'seed', 'seed'),
  ('trakt-popular-show',       'en', 'auto', 'contentRail', 'Popular Shows',           NULL, 40, 'trakt.popular',           '{"mediaType":"tv"}'::jsonb,                       true, 'seed', 'seed'),
  ('trakt-popular-region-movie','en','auto', 'contentRail', 'Popular in Your Region',  NULL, 50, 'trakt.popular-by-region', '{"mediaType":"movie"}'::jsonb,                    true, 'seed', 'seed'),
  ('trakt-anticipated-movie',  'en', 'auto', 'contentRail', 'Most Anticipated',        NULL, 60, 'trakt.anticipated',       '{"mediaType":"movie"}'::jsonb,                    true, 'seed', 'seed')
ON CONFLICT (list_key) DO NOTHING;
