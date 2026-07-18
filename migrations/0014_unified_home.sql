-- Unified home subsystem (Step 1).
-- Adds an explicit source tag to the per-list storage tables that the
-- recommendation pipeline already uses, and a templates table consumed by the
-- automatic fallback generator.

ALTER TABLE recommendation_active_lists
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'reco';

ALTER TABLE recommendation_list_versions
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'reco';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'recommendation_active_lists_source_check'
  ) THEN
    ALTER TABLE recommendation_active_lists
      ADD CONSTRAINT recommendation_active_lists_source_check
      CHECK (source IN ('custom', 'reco', 'fallback'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'recommendation_list_versions_source_check'
  ) THEN
    ALTER TABLE recommendation_list_versions
      ADD CONSTRAINT recommendation_list_versions_source_check
      CHECK (source IN ('custom', 'reco', 'fallback'));
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS home;

CREATE TABLE IF NOT EXISTS home.fallback_list_templates (
  list_key TEXT NOT NULL,
  section_type TEXT NOT NULL
    CHECK (section_type IN ('categoryTabs', 'heroCarousel', 'contentRail', 'collectionRail')),
  title TEXT NOT NULL,
  subtitle TEXT,
  rank INTEGER NOT NULL DEFAULT 0,
  provider TEXT NOT NULL
    CHECK (provider IN ('tmdb', 'tvdb', 'imdb', 'kitsu')),
  provider_id TEXT NOT NULL,
  media_type TEXT NOT NULL
    CHECK (media_type IN ('movie', 'tv')),
  score NUMERIC NULL,
  reason TEXT NULL,
  reason_codes TEXT[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (list_key, rank)
);

INSERT INTO home.fallback_list_templates (list_key, section_type, title, subtitle, rank, provider, provider_id, media_type, score, reason, reason_codes)
VALUES
  ('continue-watching', 'contentRail', 'Continue Watching', null, 1, 'tmdb', '1396', 'tv', null, null, '{}'),
  ('trending-movies', 'contentRail', 'Trending Movies', null, 1, 'tmdb', '550', 'movie', null, 'Popular right now', '{}'),
  ('trending-movies', 'contentRail', 'Trending Movies', null, 2, 'tmdb', '278', 'movie', null, 'Popular right now', '{}'),
  ('trending-movies', 'contentRail', 'Trending Movies', null, 3, 'tmdb', '238', 'movie', null, 'Popular right now', '{}'),
  ('trending-shows', 'contentRail', 'Trending Shows', null, 1, 'tmdb', '1399', 'tv', null, 'Popular right now', '{}'),
  ('trending-shows', 'contentRail', 'Trending Shows', null, 2, 'tmdb', '1396', 'tv', null, 'Popular right now', '{}'),
  ('trending-shows', 'contentRail', 'Trending Shows', null, 3, 'tmdb', '24428', 'tv', null, 'Popular right now', '{}'),
  ('top-hero', 'heroCarousel', 'Featured', null, 1, 'tmdb', '157336', 'movie', null, null, '{}'),
  ('top-hero', 'heroCarousel', 'Featured', null, 2, 'tmdb', '27205', 'movie', null, null, '{}'),
  ('top-hero', 'heroCarousel', 'Featured', null, 3, 'tmdb', '603', 'movie', null, null, '{}'),
  ('new-releases', 'contentRail', 'New Releases', null, 1, 'tmdb', '155', 'movie', null, null, '{}'),
  ('new-releases', 'contentRail', 'New Releases', null, 2, 'tmdb', '424', 'movie', null, null, '{}')
ON CONFLICT (list_key, rank) DO NOTHING;

CREATE INDEX IF NOT EXISTS recommendation_active_lists_profile_source_idx
  ON recommendation_active_lists (account_id, profile_id, source)
  WHERE deleted_at IS NULL;
