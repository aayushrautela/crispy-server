-- Add TTL to tmdb_images so expired artwork can be purged.
ALTER TABLE tmdb_images ADD COLUMN expires_at timestamptz;

-- Backfill existing images with parent title's expiry.
UPDATE tmdb_images i
SET expires_at = t.expires_at
FROM tmdb_titles t
WHERE i.media_type = t.media_type AND i.tmdb_id = t.tmdb_id;

-- Index for the purge job.
CREATE INDEX tmdb_images_expires_idx ON tmdb_images (expires_at);
