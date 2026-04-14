ALTER TABLE profile_episodic_follow_state
  ADD COLUMN next_episode_media_key TEXT,
  ADD COLUMN next_episode_season_number INTEGER,
  ADD COLUMN next_episode_episode_number INTEGER,
  ADD COLUMN next_episode_absolute_episode_number INTEGER,
  ADD COLUMN next_episode_title TEXT;
