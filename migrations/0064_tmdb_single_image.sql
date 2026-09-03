-- Migration: single canonical image per title+kind in tmdb_images.
-- First writer wins: every card/list/detail read serves the one stored row, so
-- cards and details can never disagree. Keeps the row matching the title's
-- canonical *_path (what cards show today), else the lexicographically-first
-- file, then enforces one row per (media_type, tmdb_id, kind).
-- Drops the now-dead per-title path columns and per-image variant columns
-- (language/vote/size selection no longer happens at read time).

-- 1. Where the title has a canonical path for the kind that exists in
-- tmdb_images, drop every other variant of that kind.
DELETE FROM tmdb_images i
USING tmdb_titles t
WHERE i.media_type = t.media_type
  AND i.tmdb_id = t.tmdb_id
  AND CASE i.kind
    WHEN 'poster' THEN t.poster_path
    WHEN 'backdrop' THEN t.backdrop_path
    WHEN 'logo' THEN t.logo_path
  END IS NOT NULL
  AND i.file_path <> CASE i.kind
    WHEN 'poster' THEN t.poster_path
    WHEN 'backdrop' THEN t.backdrop_path
    WHEN 'logo' THEN t.logo_path
  END;

-- 2. Collapse any remaining duplicates (no canonical path or canonical path
-- not present in tmdb_images) to a single deterministic row.
DELETE FROM tmdb_images a
USING tmdb_images b
WHERE a.media_type = b.media_type
  AND a.tmdb_id = b.tmdb_id
  AND a.kind = b.kind
  AND a.file_path > b.file_path;

-- 3. Enforce single-row-per-kind going forward.
ALTER TABLE tmdb_images
  DROP CONSTRAINT tmdb_images_pkey,
  ADD PRIMARY KEY (media_type, tmdb_id, kind);

-- 4. Drop columns nothing reads or writes anymore.
ALTER TABLE tmdb_titles
  DROP COLUMN poster_path,
  DROP COLUMN backdrop_path,
  DROP COLUMN logo_path;

ALTER TABLE tmdb_images
  DROP COLUMN iso_639_1,
  DROP COLUMN vote_average,
  DROP COLUMN vote_count,
  DROP COLUMN width,
  DROP COLUMN height;
