ALTER TABLE watch_history RENAME TO watch_history_latest;

ALTER INDEX IF EXISTS idx_watch_history_profile_watched_at
    RENAME TO idx_watch_history_latest_profile_watched_at;

ALTER INDEX IF EXISTS idx_watch_history_profile_show_episode
    RENAME TO idx_watch_history_latest_profile_show_episode;
