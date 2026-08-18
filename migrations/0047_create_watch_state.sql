CREATE TABLE user_state.watch_state (
  profile_id    uuid    NOT NULL REFERENCES identity.profiles(id) ON DELETE CASCADE,
  account_id    uuid    NOT NULL REFERENCES identity.accounts(id) ON DELETE CASCADE,
  item_id       uuid    NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  title_item_id uuid    REFERENCES content_items(id) ON DELETE CASCADE,
  media_type    text    NOT NULL,
  season_number integer,
  episode_number integer,
  played        boolean NOT NULL DEFAULT false,
  play_count    integer NOT NULL DEFAULT 0,
  last_played_at timestamptz,
  position_seconds numeric NOT NULL DEFAULT 0,
  duration_seconds numeric,
  progress_bps  integer,
  rating        numeric(3, 1),
  is_favorite   boolean NOT NULL DEFAULT false,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, item_id)
);

COMMENT ON TABLE user_state.watch_state IS
  'Jellyfin-style per-(profile,item) watch state. One row per playable item per profile.';

CREATE INDEX watch_state_history_idx
  ON user_state.watch_state (profile_id, last_played_at DESC)
  WHERE last_played_at IS NOT NULL;

CREATE INDEX watch_state_continue_idx
  ON user_state.watch_state (profile_id, updated_at DESC)
  WHERE NOT played AND position_seconds > 0;

CREATE INDEX watch_state_title_idx
  ON user_state.watch_state (profile_id, title_item_id);

CREATE INDEX watch_state_favorite_idx
  ON user_state.watch_state (profile_id)
  WHERE is_favorite;
