ALTER TABLE user_state.watch_events
  ADD COLUMN season_number SMALLINT,
  ADD COLUMN episode_number SMALLINT;

CREATE INDEX watch_events_profile_title_season_episode
  ON user_state.watch_events (profile_id, title_item_id, season_number DESC, episode_number DESC)
  WHERE media_type = 'episode';

UPDATE user_state.watch_events we
SET season_number = pp.season_number,
    episode_number = pp.episode_number
FROM user_state.playback_progress pp
WHERE we.media_type = 'episode'
  AND pp.profile_id = we.profile_id
  AND pp.title_item_id = we.title_item_id
  AND pp.season_number IS NOT NULL
  AND pp.playable_item_id = we.item_id;
