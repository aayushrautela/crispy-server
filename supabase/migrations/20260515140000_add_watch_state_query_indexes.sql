-- Add indexes to optimize single-query get_profile_watch_state lookups
-- The primary join is on (profile_id, media_key) for media_watch_summary

CREATE INDEX IF NOT EXISTS idx_media_watch_summary_profile_media
  ON user_state.media_watch_summary (profile_id, media_key);

-- Also add a covering index for the LATERAL watched_episode_keys subquery
-- which filters on (profile_id, title_media_key, media_type, effective_watched)
CREATE INDEX IF NOT EXISTS idx_media_watch_summary_watched_episodes
  ON user_state.media_watch_summary (profile_id, title_media_key, media_type, effective_watched);
