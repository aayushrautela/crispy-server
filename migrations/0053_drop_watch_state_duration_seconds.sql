-- 0053_drop_watch_state_duration_seconds.sql
--
-- Remove the vestigial user_state.watch_state.duration_seconds column. Runtime is
-- derived from TMDB metadata at read time (per the 0050 slim-watch-state design), so a
-- stored per-row duration is redundant and was never written. 0052 added it only to
-- satisfy a read-path COALESCE fallback (ws.duration_seconds) that has since been removed
-- from the query, so the column is now unused.

ALTER TABLE user_state.watch_state
  DROP COLUMN IF EXISTS duration_seconds;
