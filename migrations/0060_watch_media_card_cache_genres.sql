-- Add genres column to watch_media_card_cache
-- Phase 5 of MEDIA_METADATA_STANDARDIZATION_PLAN

ALTER TABLE watch_media_card_cache
  ADD COLUMN IF NOT EXISTS genres jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Add comment
COMMENT ON COLUMN watch_media_card_cache.genres IS 'Array of genre names from TMDB (e.g., ["Action", "Science Fiction"])';
