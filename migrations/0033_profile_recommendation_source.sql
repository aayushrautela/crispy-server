-- Add recommendation_source to profiles.
--
-- 'reco' = our nightly job generates recommendations (default)
-- 'custom' = user sends recommendations via PAT, we skip nightly job

ALTER TABLE identity.profiles
  ADD COLUMN recommendation_source VARCHAR NOT NULL DEFAULT 'reco';

ALTER TABLE identity.profiles
  ADD CONSTRAINT chk_profiles_recommendation_source
    CHECK (recommendation_source IN ('reco', 'custom'));

CREATE INDEX idx_profiles_recommendation_source_reco
  ON identity.profiles (account_id, id)
  WHERE recommendation_source = 'reco';
