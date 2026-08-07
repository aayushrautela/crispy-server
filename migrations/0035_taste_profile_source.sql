-- Simplify taste_profiles: remove audit columns, add source column.
--
-- The updated_by_id/updated_by_kind columns were a half-finished audit system.
-- Replace with a simple `source` column that identifies what generated the profile.

ALTER TABLE taste_profiles
  DROP COLUMN IF EXISTS updated_by_id,
  DROP COLUMN IF EXISTS updated_by_kind;

ALTER TABLE taste_profiles
  ADD COLUMN source VARCHAR NOT NULL DEFAULT 'reco';
