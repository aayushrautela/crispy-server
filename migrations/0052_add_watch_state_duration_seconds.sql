-- 0052_add_watch_state_duration_seconds.sql
--
-- Re-add user_state.watch_state.duration_seconds, which 0050_slim_watch_state dropped.
-- The read model resolves runtime as COALESCE(tmdb runtime, ..., ws.duration_seconds),
-- so the column must exist for that query to compile even though writes currently leave
-- it null. It serves as a last-resort stored-runtime fallback when TMDB metadata is absent.

ALTER TABLE user_state.watch_state
  ADD COLUMN IF NOT EXISTS duration_seconds numeric;
