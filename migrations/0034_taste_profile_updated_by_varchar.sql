-- Fix taste_profiles.updated_by_id to accept service identifiers.
--
-- The column was UUID but the auth layer passes service key IDs like
-- "reco-env-var-token" which are not valid UUIDs. Change to VARCHAR to
-- match the flexible actor pattern used by recommendations.

ALTER TABLE taste_profiles
  ALTER COLUMN updated_by_id TYPE VARCHAR USING updated_by_id::text;
