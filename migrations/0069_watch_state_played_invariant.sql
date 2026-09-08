-- Enforce the watch_state play-state invariant at the schema level.
--
-- user_state.watch_state encodes two coupled facts on one row: the resume
-- bookmark (position_seconds) and the completion history (played, play_count).
-- The play-state machine (recordPlaybackState, markWatched) maintains:
--   played = true  <=> the most recent viewing completed <=> position_seconds = 0
--   position_seconds > 0 <=> viewing in progress <=> played = false
-- Older builds (pre-31ad140 position-only resolution) flipped mid-progress
-- titles to played with a live position, and the in-progress upsert never
-- cleared the flag, so rewatches of completed titles silently dropped out of
-- Continue Watching. Heal those rows, then make the invariant impossible to
-- violate for any future writer.

UPDATE user_state.watch_state
SET played = false
WHERE played = true
  AND position_seconds > 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'watch_state_played_position_check'
      AND conrelid = 'user_state.watch_state'::regclass
  ) THEN
    ALTER TABLE user_state.watch_state
      ADD CONSTRAINT watch_state_played_position_check
      CHECK (played = false OR position_seconds = 0) NOT VALID;
  END IF;
END $$;

ALTER TABLE user_state.watch_state
  VALIDATE CONSTRAINT watch_state_played_position_check;
