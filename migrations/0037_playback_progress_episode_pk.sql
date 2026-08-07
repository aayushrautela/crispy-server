ALTER TABLE user_state.playback_progress
  DROP CONSTRAINT playback_progress_pkey;

ALTER TABLE user_state.playback_progress
  ADD PRIMARY KEY (profile_id, title_item_id, playable_item_id);

ALTER TABLE user_state.playback_progress
  ADD COLUMN season_number integer,
  ADD COLUMN episode_number integer;
