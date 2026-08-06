-- Remove the denormalized watched-state projection.
--
-- `user_state.media_watch_summary` duplicated facts already recorded in
-- `user_state.watch_events`, but nothing kept the two in sync: provider imports
-- (LocalProviderHistoryWriter) only ever wrote the event log, so the summary
-- contained just the rows produced by in-app mark-watched actions. Watched state
-- is now derived directly from the event log ("latest event wins"), which makes
-- the log the single source of truth and removes the sync gap entirely.
--
-- Point lookups against the log need indexes that did not previously exist:
-- every existing index was shaped for "list my history, newest first".

CREATE INDEX IF NOT EXISTS watch_events_profile_item_idx
  ON user_state.watch_events (profile_id, item_id, occurred_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS watch_events_profile_title_idx
  ON user_state.watch_events (profile_id, title_item_id, occurred_at DESC, id DESC);

-- `watch_events_completed_episode_idx` was declared as a partial index on
-- media_type = 'episode' AND event_type = 'playback_completed'. Imported episode
-- rows are written with the canonical *title* media type ('show'), so the
-- predicate has never matched a single row. Episode lookups are served by
-- watch_events_profile_title_idx instead.
DROP INDEX IF EXISTS user_state.watch_events_completed_episode_idx;

DROP TABLE IF EXISTS user_state.media_watch_summary CASCADE;
