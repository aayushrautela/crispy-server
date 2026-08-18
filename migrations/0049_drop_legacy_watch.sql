-- Remove the legacy watch model. watch_state (0047/0048) is now the source of truth.
-- The watchlist is folded into the Jellyfin-style is_favorite flag on watch_state.

DROP TABLE IF EXISTS user_state.watch_events;
DROP TABLE IF EXISTS user_state.playback_progress;
DROP TABLE IF EXISTS user_state.profile_ratings;
DROP TABLE IF EXISTS user_state.profile_list_items;
DROP TABLE IF EXISTS user_state.profile_watch_data_state;
DROP TABLE IF EXISTS user_state.watch_sessions;
