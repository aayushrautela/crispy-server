ALTER TABLE watch_media_card_cache
  ADD COLUMN IF NOT EXISTS trailer_url text,
  ADD COLUMN IF NOT EXISTS trailer_thumbnail_url text,
  ADD COLUMN IF NOT EXISTS poster_color text,
  ADD COLUMN IF NOT EXISTS backdrop_color text;

COMMENT ON COLUMN watch_media_card_cache.trailer_url IS 'Best trailer URL for compact card enrichment.';
COMMENT ON COLUMN watch_media_card_cache.trailer_thumbnail_url IS 'Best trailer thumbnail URL for compact card enrichment.';
COMMENT ON COLUMN watch_media_card_cache.poster_color IS 'Externally extracted dominant/accent color for poster artwork.';
COMMENT ON COLUMN watch_media_card_cache.backdrop_color IS 'Externally extracted dominant/accent color for backdrop artwork.';
