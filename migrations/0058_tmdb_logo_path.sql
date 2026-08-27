-- Migration: add logo_path to tmdb_titles for logo fallback when tmdb_images not yet cached
-- Summary-cached titles from search/discover/known-for often lack logo images in tmdb_images,
-- so we store the best logo_path directly on the title row for fallback.

ALTER TABLE tmdb_titles ADD COLUMN IF NOT EXISTS logo_path text;
