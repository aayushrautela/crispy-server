ALTER TABLE user_state.playback_progress
  ALTER COLUMN position_seconds TYPE numeric,
  ALTER COLUMN duration_seconds TYPE numeric;

ALTER TABLE user_state.watch_events
  ALTER COLUMN position_seconds TYPE numeric,
  ALTER COLUMN duration_seconds TYPE numeric;
