ALTER TABLE watch_media_card_cache
  ADD COLUMN IF NOT EXISTS still_url text;

COMMENT ON COLUMN watch_media_card_cache.still_url IS 'Episode still image URL for episode-level artwork enrichment.';
