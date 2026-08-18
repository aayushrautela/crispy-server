-- 0050_slim_watch_state.sql
--
-- Collapse user_state.watch_state to a Jellyfin-style minimal user-state row
-- (one row per profile + item). All descriptive attributes (media_type,
-- season/episode, series linkage, duration, progress) and the redundant
-- account_id / updated_at are dropped: they are either derivable from the
-- content graph at read time (Jellyfin resolves these from the Item, not from
-- UserData) or computed.
--
-- Recency for continue-watching / lists now uses last_played_at, which every
-- write sets to now().

ALTER TABLE user_state.watch_state
  DROP COLUMN IF EXISTS account_id,
  DROP COLUMN IF EXISTS title_item_id,
  DROP COLUMN IF EXISTS media_type,
  DROP COLUMN IF EXISTS season_number,
  DROP COLUMN IF EXISTS episode_number,
  DROP COLUMN IF EXISTS duration_seconds,
  DROP COLUMN IF EXISTS progress_bps,
  DROP COLUMN IF EXISTS updated_at;

DROP INDEX IF EXISTS user_state.watch_state_title_idx;
DROP INDEX IF EXISTS user_state.watch_state_continue_idx;
DROP INDEX IF EXISTS user_state.watch_state_history_idx;
DROP INDEX IF EXISTS user_state.watch_state_favorite_idx;

CREATE INDEX watch_state_continue_idx
  ON user_state.watch_state (profile_id, last_played_at DESC)
  WHERE NOT played AND position_seconds > 0;

CREATE INDEX watch_state_history_idx
  ON user_state.watch_state (profile_id, last_played_at DESC)
  WHERE last_played_at IS NOT NULL;

CREATE INDEX watch_state_favorite_idx
  ON user_state.watch_state (profile_id)
  WHERE is_favorite;
