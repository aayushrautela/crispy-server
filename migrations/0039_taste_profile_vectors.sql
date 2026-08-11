-- Add vectors column to taste_profiles for high-fidelity taste profile storage.
--
-- The worker now emits a "vectors" object containing short-term and long-term
-- taste scores/counts for genres, tags, people, mood, and decades. This
-- preserves the full dual-timeline model that flat string arrays cannot
-- represent.

ALTER TABLE taste_profiles
  ADD COLUMN vectors JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Index for optional future queries on vector content (e.g. "find profiles
-- where vectors.tags[*].name == 'neo-noir'"). Not strictly required today
-- but cheap to add and avoids a future migration.
CREATE INDEX taste_profiles_vectors_gin_idx
  ON taste_profiles USING GIN (vectors);
