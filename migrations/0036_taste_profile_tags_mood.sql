-- Add tags and mood to taste_profiles for dense profile storage.
--
-- The worker generates tags and mood dimensions that are essential for
-- scoring and connections. Store them as JSONB for flexible querying.

ALTER TABLE taste_profiles
  ADD COLUMN tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN mood JSONB NOT NULL DEFAULT '[]'::jsonb;
