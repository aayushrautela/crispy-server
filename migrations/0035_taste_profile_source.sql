-- Simplify taste_profiles: remove audit columns, add source column.
--
-- The updated_by_id/updated_by_kind columns were a half-finished audit system.
-- Replace with a simple `source` column that identifies what generated the profile.
--
-- Idempotent for fresh installs: the baseline 0001 schema already ships
-- taste_profiles with a `source` column (default 'unknown'), so the ADD COLUMN
-- becomes a no-op there and the default is normalized to 'reco'.

ALTER TABLE taste_profiles
  DROP COLUMN IF EXISTS updated_by_id,
  DROP COLUMN IF EXISTS updated_by_kind;

ALTER TABLE taste_profiles
  ADD COLUMN IF NOT EXISTS source VARCHAR NOT NULL DEFAULT 'reco';

ALTER TABLE taste_profiles
  ALTER COLUMN source SET DEFAULT 'reco';
