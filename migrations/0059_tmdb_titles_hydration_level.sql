ALTER TABLE tmdb_titles
  ADD COLUMN IF NOT EXISTS hydration_level text NOT NULL DEFAULT 'detail'
    CHECK (hydration_level IN ('summary', 'detail'));

CREATE INDEX IF NOT EXISTS idx_tmdb_titles_hydration_level ON tmdb_titles(hydration_level);
