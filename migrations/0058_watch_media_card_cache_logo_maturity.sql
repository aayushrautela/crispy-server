-- Add logo_url and maturity_rating to watch_media_card_cache
-- Phase 4 of MEDIA_METADATA_STANDARDIZATION_PLAN

ALTER TABLE watch_media_card_cache
  ADD COLUMN IF NOT EXISTS logo_url TEXT,
  ADD COLUMN IF NOT EXISTS maturity_rating TEXT;

-- Create index on logo_url for future queries if needed
CREATE INDEX IF NOT EXISTS idx_watch_media_card_cache_logo_url
  ON watch_media_card_cache (logo_url)
  WHERE logo_url IS NOT NULL;

-- Create index on maturity_rating for future queries if needed
CREATE INDEX IF NOT EXISTS idx_watch_media_card_cache_maturity_rating
  ON watch_media_card_cache (maturity_rating)
  WHERE maturity_rating IS NOT NULL;

-- Add comment
COMMENT ON COLUMN watch_media_card_cache.logo_url IS 'Logo image URL from TMDB (sparse)';
COMMENT ON COLUMN watch_media_card_cache.maturity_rating IS 'Maturity/certification rating (e.g., PG-13, TV-MA)';
