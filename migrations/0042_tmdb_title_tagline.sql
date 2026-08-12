ALTER TABLE tmdb_titles
  ADD COLUMN IF NOT EXISTS tagline text;
