CREATE TABLE IF NOT EXISTS profile_title_metadata_state (
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title_content_id UUID NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  title_media_key TEXT NOT NULL,
  next_episode_air_date DATE,
  metadata_refreshed_at TIMESTAMPTZ,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (profile_id, title_content_id)
);

CREATE INDEX IF NOT EXISTS profile_title_metadata_state_profile_media_key_idx
  ON profile_title_metadata_state (profile_id, title_media_key);

CREATE INDEX IF NOT EXISTS profile_title_metadata_state_profile_next_air_idx
  ON profile_title_metadata_state (profile_id, next_episode_air_date);
