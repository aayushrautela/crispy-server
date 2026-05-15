DROP INDEX IF EXISTS profile_settings_official_reco_enabled_idx;

ALTER TABLE profile_settings
  DROP COLUMN IF EXISTS use_official_recommendation_engine;
