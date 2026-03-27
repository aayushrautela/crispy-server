ALTER TABLE continue_watching_projection
    ADD COLUMN IF NOT EXISTS canonical_media_key text;

UPDATE continue_watching_projection
SET canonical_media_key = CASE
    WHEN media_type = 'movie' AND tmdb_id IS NOT NULL THEN 'movie:tmdb:' || tmdb_id::text
    WHEN media_type = 'show' AND tmdb_id IS NOT NULL THEN 'show:tmdb:' || tmdb_id::text
    WHEN media_type = 'episode' AND show_tmdb_id IS NOT NULL THEN 'show:tmdb:' || show_tmdb_id::text
    ELSE media_key
END
WHERE canonical_media_key IS NULL
   OR canonical_media_key = '';

WITH ranked_rows AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY profile_id, canonical_media_key
               ORDER BY last_activity_at DESC, updated_at DESC, id DESC
           ) AS row_number
    FROM continue_watching_projection
)
DELETE FROM continue_watching_projection target
USING ranked_rows ranked
WHERE target.id = ranked.id
  AND ranked.row_number > 1;

ALTER TABLE continue_watching_projection
    ALTER COLUMN canonical_media_key SET NOT NULL;

ALTER TABLE continue_watching_projection
    DROP CONSTRAINT IF EXISTS continue_watching_projection_profile_id_media_key_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_continue_watching_profile_canonical
    ON continue_watching_projection(profile_id, canonical_media_key);
