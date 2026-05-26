ALTER TABLE tmdb_titles
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS runtime integer,
  ADD COLUMN IF NOT EXISTS episode_run_time jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS number_of_seasons integer,
  ADD COLUMN IF NOT EXISTS number_of_episodes integer,
  ADD COLUMN IF NOT EXISTS external_ids jsonb NOT NULL DEFAULT '{}'::jsonb;
