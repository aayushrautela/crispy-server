CREATE INDEX IF NOT EXISTS idx_profile_watchlist_state_present_added
    ON profile_watchlist_state(profile_id, added_at DESC, target_content_id DESC)
    WHERE present = true AND added_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profile_rating_state_present_rated
    ON profile_rating_state(profile_id, rated_at DESC, target_content_id DESC)
    WHERE rating IS NOT NULL AND rated_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profile_title_projection_history_last_watched
    ON profile_title_projection(profile_id, last_watched_at DESC, title_content_id DESC)
    WHERE effective_watched = true AND last_watched_at IS NOT NULL;
