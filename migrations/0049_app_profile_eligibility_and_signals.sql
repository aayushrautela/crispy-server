-- Profile eligibility projections and change feed

CREATE TABLE profile_eligibility_projections (
  account_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  purpose text NOT NULL,
  eligible boolean NOT NULL DEFAULT false,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  eligibility_version integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (account_id, profile_id, purpose),
  CONSTRAINT profile_eligibility_projections_purpose_check
    CHECK (purpose IN ('recommendation-generation'))
);

CREATE INDEX profile_eligibility_projections_eligible_idx
  ON profile_eligibility_projections (purpose, eligible, updated_at DESC)
  WHERE eligible = true;

CREATE TABLE eligible_profile_change_feed (
  sequence bigserial PRIMARY KEY,
  change_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  event_type text NOT NULL,
  eligible boolean NOT NULL,
  eligibility_version integer NOT NULL DEFAULT 0,
  signals_version integer NOT NULL DEFAULT 0,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommended_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  changed_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT eligible_profile_change_feed_event_type_check
    CHECK (event_type IN ('initial', 'profile_updated', 'signals_changed', 'consent_changed', 'settings_changed', 'eligibility_changed', 'account_changed'))
);

CREATE INDEX eligible_profile_change_feed_sequence_idx
  ON eligible_profile_change_feed (sequence ASC);
CREATE INDEX eligible_profile_change_feed_account_profile_idx
  ON eligible_profile_change_feed (account_id, profile_id, changed_at DESC);

CREATE TABLE eligible_profile_change_checkpoints (
  app_id text NOT NULL,
  consumer_id text NULL,
  sequence bigint NOT NULL,
  cursor text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (app_id, consumer_id)
);

-- Eligible profile snapshots

CREATE TABLE eligible_profile_snapshots (
  snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id text NOT NULL,
  purpose text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text NOT NULL,
  requested_by jsonb NULL,
  estimated_profile_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by text NULL,
  approved_at timestamptz NULL,

  CONSTRAINT eligible_profile_snapshots_status_check
    CHECK (status IN ('draft', 'pending_approval', 'active', 'paused', 'cancelled', 'completed', 'expired')),
  CONSTRAINT eligible_profile_snapshots_purpose_check
    CHECK (purpose IN ('recommendation-generation'))
);

CREATE INDEX eligible_profile_snapshots_app_created_idx
  ON eligible_profile_snapshots (app_id, created_at DESC);

CREATE TABLE eligible_profile_snapshot_items (
  snapshot_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL REFERENCES eligible_profile_snapshots(snapshot_id) ON DELETE CASCADE,
  item_offset integer NOT NULL,
  account_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  eligibility_version integer NOT NULL DEFAULT 0,
  signals_version integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  lease_id uuid NULL,
  lease_expires_at timestamptz NULL,
  completed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT eligible_profile_snapshot_items_status_check
    CHECK (status IN ('pending', 'leased', 'completed', 'failed', 'skipped', 'cancelled', 'expired')),
  UNIQUE (snapshot_id, account_id, profile_id)
);

CREATE INDEX eligible_profile_snapshot_items_snapshot_offset_idx
  ON eligible_profile_snapshot_items (snapshot_id, item_offset ASC);
CREATE INDEX eligible_profile_snapshot_items_snapshot_status_idx
  ON eligible_profile_snapshot_items (snapshot_id, status, item_offset ASC)
  WHERE status IN ('pending', 'leased');

-- Profile signal versions

CREATE TABLE profile_signal_versions (
  account_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  signals_version integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (account_id, profile_id)
);

-- Profile signal projections for app consumption

CREATE TABLE app_profile_history_signals (
  account_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  content_id text NOT NULL,
  content_type text NOT NULL,
  watched_at timestamptz NOT NULL,
  progress_percent integer NOT NULL DEFAULT 0,
  completion_state text NOT NULL,
  duration_seconds integer NULL,

  PRIMARY KEY (account_id, profile_id, content_id, watched_at)
);

CREATE INDEX app_profile_history_signals_profile_watched_idx
  ON app_profile_history_signals (account_id, profile_id, watched_at DESC);

CREATE TABLE app_profile_rating_signals (
  account_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  content_id text NOT NULL,
  rating numeric(3,1) NOT NULL,
  rated_at timestamptz NOT NULL,
  rating_source text NULL,

  PRIMARY KEY (account_id, profile_id, content_id)
);

CREATE INDEX app_profile_rating_signals_profile_rated_idx
  ON app_profile_rating_signals (account_id, profile_id, rated_at DESC);

CREATE TABLE app_profile_watchlist_signals (
  account_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  content_id text NOT NULL,
  added_at timestamptz NOT NULL,

  PRIMARY KEY (account_id, profile_id, content_id)
);

CREATE INDEX app_profile_watchlist_signals_profile_added_idx
  ON app_profile_watchlist_signals (account_id, profile_id, added_at DESC);

CREATE TABLE app_profile_continue_watching_signals (
  account_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  content_id text NOT NULL,
  season_number integer NULL,
  episode_number integer NULL,
  progress_percent integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL,

  PRIMARY KEY (account_id, profile_id, content_id)
);

CREATE INDEX app_profile_continue_watching_signals_profile_updated_idx
  ON app_profile_continue_watching_signals (account_id, profile_id, updated_at DESC);
