-- Fallback home: source-driven rails (per-locale).
--
-- Replaces the per-title static rows from 0014 with one row per RAIL that
-- references a list source (TMDB trending/popular, Trakt list, continue-watching,
-- etc.) plus JSON config. The seed job resolves each source to items at write
-- time, so the DB stores intent, not frozen title lists.
--
-- 0014's content is dropped: it only carried 12 seeded demo rows and no
-- profile has consumed them yet (recommendation_active_lists has 0 rows).

DROP TABLE IF EXISTS home.fallback_list_templates;

CREATE TABLE home.fallback_list_templates (
  list_key          text    NOT NULL,
  locale            text    NOT NULL,
  section_type      text    NOT NULL CHECK (section_type IN ('categoryTabs', 'heroCarousel', 'contentRail', 'collectionRail')),
  title             text    NOT NULL,
  subtitle          text,
  rank              integer NOT NULL DEFAULT 0,
  source_id         text    NOT NULL,
  source_config     jsonb   NOT NULL DEFAULT '{}'::jsonb,
  refresh_minutes   integer,
  last_refreshed_at timestamptz,
  is_active         boolean NOT NULL DEFAULT true,
  created_by        text    NOT NULL DEFAULT 'system',
  updated_by        text    NOT NULL DEFAULT 'system',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (list_key, locale),
  CONSTRAINT fallback_list_templates_refresh_chk
    CHECK (refresh_minutes IS NULL OR refresh_minutes >= 1)
);

CREATE INDEX home_fallback_tpl_locale_idx
  ON home.fallback_list_templates (locale) WHERE is_active;
CREATE INDEX home_fallback_tpl_refresh_idx
  ON home.fallback_list_templates (refresh_minutes)
  WHERE refresh_minutes IS NOT NULL AND is_active;

-- Default rails seeded for a few broad locales. Any other locale inherits the
-- 'en' rows at read time (exact locale -> primary tag -> en, see resolver).
INSERT INTO home.fallback_list_templates (list_key, locale, section_type, title, subtitle, rank, source_id, source_config, is_active, created_by) VALUES
  ('trending-movies',   'en', 'heroCarousel', 'Trending This Week',     NULL, 10, 'tmdb.trending',          '{"mediaType":"movie","timeWindow":"week","limit":20}'::jsonb, true, 'seed'),
  ('trending-shows',    'en', 'heroCarousel', 'Trending TV',            NULL, 20, 'tmdb.trending',          '{"mediaType":"tv","timeWindow":"week","limit":20}'::jsonb,    true, 'seed'),
  ('popular-movies',    'en', 'contentRail',  'Popular Movies',         NULL, 30, 'tmdb.popular',           '{"mediaType":"movie","limit":40}'::jsonb,                     true, 'seed'),
  ('popular-shows',     'en', 'contentRail',  'Popular Shows',          NULL, 40, 'tmdb.popular',           '{"mediaType":"tv","limit":40}'::jsonb,                       true, 'seed'),
  ('new-releases',      'en', 'contentRail',  'New This Week',          NULL, 50, 'tmdb.discover-by-genre', '{"mediaType":"movie","sortBy":"release_date.desc","voteAverageGte":5,"limit":40,"genreId":null}'::jsonb, true, 'seed'),
  ('continue-watching', 'en', 'contentRail',  'Continue Watching',      NULL,  0, 'home.continue-watching', '{}'::jsonb,                                                     true, 'seed'),

  ('trending-movies',   'es', 'heroCarousel', 'Tendencias Esta Semana', NULL, 10, 'tmdb.trending',          '{"mediaType":"movie","timeWindow":"week","limit":20}'::jsonb, true, 'seed'),
  ('trending-shows',    'es', 'heroCarousel', 'Series en Tendencia',    NULL, 20, 'tmdb.trending',          '{"mediaType":"tv","timeWindow":"week","limit":20}'::jsonb,    true, 'seed'),
  ('popular-movies',    'es', 'contentRail',  'Películas Populares',    NULL, 30, 'tmdb.popular',           '{"mediaType":"movie","limit":40}'::jsonb,                     true, 'seed'),
  ('popular-shows',     'es', 'contentRail',  'Series Populares',       NULL, 40, 'tmdb.popular',           '{"mediaType":"tv","limit":40}'::jsonb,                       true, 'seed'),
  ('new-releases',      'es', 'contentRail',  'Estrenos de la Semana',  NULL, 50, 'tmdb.discover-by-genre', '{"mediaType":"movie","sortBy":"release_date.desc","voteAverageGte":5,"limit":40,"genreId":null}'::jsonb, true, 'seed'),
  ('continue-watching', 'es', 'contentRail',  'Continuar Viendo',       NULL,  0, 'home.continue-watching', '{}'::jsonb,                                                     true, 'seed'),

  ('trending-movies',   'fr', 'heroCarousel', 'Tendances Cette Semaine',NULL, 10, 'tmdb.trending',          '{"mediaType":"movie","timeWindow":"week","limit":20}'::jsonb, true, 'seed'),
  ('trending-shows',    'fr', 'heroCarousel', 'Séries en Tendance',     NULL, 20, 'tmdb.trending',          '{"mediaType":"tv","timeWindow":"week","limit":20}'::jsonb,    true, 'seed'),
  ('popular-movies',    'fr', 'contentRail',  'Films Populaires',       NULL, 30, 'tmdb.popular',           '{"mediaType":"movie","limit":40}'::jsonb,                     true, 'seed'),
  ('popular-shows',     'fr', 'contentRail',  'Séries Populaires',      NULL, 40, 'tmdb.popular',           '{"mediaType":"tv","limit":40}'::jsonb,                       true, 'seed'),
  ('new-releases',      'fr', 'contentRail',  'Nouveautés',             NULL, 50, 'tmdb.discover-by-genre', '{"mediaType":"movie","sortBy":"release_date.desc","voteAverageGte":5,"limit":40,"genreId":null}'::jsonb, true, 'seed'),
  ('continue-watching', 'fr', 'contentRail',  'Continuer',              NULL,  0, 'home.continue-watching', '{}'::jsonb,                                                     true, 'seed'),

  ('trending-movies',   'de', 'heroCarousel', 'Diese Woche Beliebt',    NULL, 10, 'tmdb.trending',          '{"mediaType":"movie","timeWindow":"week","limit":20}'::jsonb, true, 'seed'),
  ('trending-shows',    'de', 'heroCarousel', 'Beliebte Serien',        NULL, 20, 'tmdb.trending',          '{"mediaType":"tv","timeWindow":"week","limit":20}'::jsonb,    true, 'seed'),
  ('popular-movies',    'de', 'contentRail',  'Beliebte Filme',         NULL, 30, 'tmdb.popular',           '{"mediaType":"movie","limit":40}'::jsonb,                     true, 'seed'),
  ('popular-shows',     'de', 'contentRail',  'Beliebte Serien',        NULL, 40, 'tmdb.popular',           '{"mediaType":"tv","limit":40}'::jsonb,                       true, 'seed'),
  ('new-releases',      'de', 'contentRail',  'Neu Diese Woche',        NULL, 50, 'tmdb.discover-by-genre', '{"mediaType":"movie","sortBy":"release_date.desc","voteAverageGte":5,"limit":40,"genreId":null}'::jsonb, true, 'seed'),
  ('continue-watching', 'de', 'contentRail',  'Weiterschauen',          NULL,  0, 'home.continue-watching', '{}'::jsonb,                                                     true, 'seed');

-- Global cache of resolved fallback rails. One row per (list_key, locale,
-- source_id); refreshed by the home-fallback-refresh worker so N profiles share
-- a single upstream fetch per refresh interval instead of each fetching live.
CREATE TABLE IF NOT EXISTS home.fallback_list_versions (
  list_key        text    NOT NULL,
  locale          text    NOT NULL,
  source_id       text    NOT NULL,
  section_type    text    NOT NULL,
  title           text    NOT NULL,
  subtitle        text,
  rank            integer NOT NULL DEFAULT 0,
  items_json      jsonb   NOT NULL DEFAULT '[]'::jsonb,
  item_count      integer NOT NULL DEFAULT 0,
  refreshed_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (list_key, locale, source_id)
);
