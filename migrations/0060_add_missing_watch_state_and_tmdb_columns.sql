-- 0060_add_missing_watch_state_and_tmdb_columns.sql
--
-- Add columns that the current read paths expect but which are missing from
-- the deployed database. Both are safe IF NOT EXISTS operations:
--   - user_state.watch_state.duration_seconds: selected by
--     local-user-watch.service.ts (continue-watching/history/watchlist)
--   - tmdb_titles.logo_path: selected by tmdb.repo.ts (home/search)

ALTER TABLE user_state.watch_state
  ADD COLUMN IF NOT EXISTS duration_seconds numeric;

ALTER TABLE tmdb_titles
  ADD COLUMN IF NOT EXISTS logo_path text;
