-- Rebuild local user-data tables after 0064 retired them.
-- Now moving from Supabase to local Postgres, with Supabase Auth only.

-- Schemas
CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS private;
CREATE SCHEMA IF NOT EXISTS user_state;
CREATE SCHEMA IF NOT EXISTS recommendation;
CREATE SCHEMA IF NOT EXISTS read_model;
CREATE SCHEMA IF NOT EXISTS ops;

-- ============================================================
-- IDENTITY
-- ============================================================

CREATE TABLE identity.accounts (
  id uuid PRIMARY KEY,
  email text NULL,
  display_name text NULL,
  avatar_url text NULL,
  deleted_at timestamptz NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_accounts_email ON identity.accounts (email) WHERE email IS NOT NULL;

CREATE TABLE identity.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES identity.accounts(id),
  name text NOT NULL CHECK (btrim(name) <> ''),
  avatar_key text NULL,
  is_kids boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  is_default boolean NOT NULL DEFAULT false,
  deleted_at timestamptz NULL,
  created_by_account_id uuid NULL REFERENCES identity.accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_profiles_account ON identity.profiles (account_id, deleted_at);
CREATE INDEX idx_profiles_account_active ON identity.profiles (account_id) WHERE deleted_at IS NULL;

CREATE TABLE identity.profile_members (
  profile_id uuid NOT NULL REFERENCES identity.profiles(id),
  account_id uuid NOT NULL REFERENCES identity.accounts(id),
  role text NOT NULL CHECK (role IN ('owner', 'member', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, account_id)
);

CREATE INDEX idx_profile_members_account ON identity.profile_members (account_id);

CREATE TABLE identity.account_preferences (
  account_id uuid PRIMARY KEY REFERENCES identity.accounts(id),
  settings_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE identity.profile_preferences (
  profile_id uuid PRIMARY KEY REFERENCES identity.profiles(id),
  settings_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE identity.account_entitlements (
  account_id uuid PRIMARY KEY REFERENCES identity.accounts(id),
  tier text NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'lite', 'pro', 'ultra')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'trialing', 'past_due', 'canceled', 'comped')),
  features jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(features) = 'object'),
  renews_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- PRIVATE
-- ============================================================

CREATE TABLE private.account_secrets (
  account_id uuid PRIMARY KEY REFERENCES identity.accounts(id),
  secrets_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE private.personal_access_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES identity.accounts(id),
  name text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  token_preview text NOT NULL,
  scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  expires_at timestamptz NULL,
  last_used_at timestamptz NULL,
  revoked_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pat_account ON private.personal_access_tokens (account_id, created_at DESC);

-- ============================================================
-- USER STATE
-- ============================================================

CREATE TABLE user_state.watch_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES identity.accounts(id),
  profile_id uuid NOT NULL REFERENCES identity.profiles(id),
  media_key text NOT NULL,
  title_media_key text NOT NULL,
  media_type text NOT NULL CHECK (media_type IN ('movie', 'show', 'season', 'episode')),
  event_type text NOT NULL CHECK (event_type IN ('playback_completed', 'marked_watched', 'marked_unwatched')),
  occurred_at timestamptz NOT NULL,
  position_seconds integer NULL,
  duration_seconds integer NULL,
  progress_bps smallint NULL,
  watch_session_id uuid NULL,
  source_kind text NOT NULL DEFAULT 'local',
  source_provider text NULL,
  import_batch_id uuid NULL,
  client_event_id text NULL,
  last_actor_account_id uuid NULL REFERENCES identity.accounts(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_watch_events_profile_occurred ON user_state.watch_events (profile_id, occurred_at DESC);
CREATE INDEX idx_watch_events_profile_title ON user_state.watch_events (profile_id, title_media_key, occurred_at DESC);
CREATE INDEX idx_watch_events_profile_media ON user_state.watch_events (profile_id, media_key, occurred_at DESC);
CREATE INDEX idx_watch_events_client_event ON user_state.watch_events (client_event_id) WHERE client_event_id IS NOT NULL;

CREATE TABLE user_state.playback_progress (
  profile_id uuid NOT NULL REFERENCES identity.profiles(id),
  title_media_key text NOT NULL,
  playable_media_key text NOT NULL,
  media_type text NOT NULL CHECK (media_type IN ('movie', 'show', 'season', 'episode')),
  position_seconds integer NULL,
  duration_seconds integer NULL,
  progress_bps smallint NULL,
  last_activity_at timestamptz NOT NULL,
  dismissed_at timestamptz NULL,
  source_kind text NOT NULL DEFAULT 'local',
  source_provider text NULL,
  account_id uuid NOT NULL REFERENCES identity.accounts(id),
  last_actor_account_id uuid NULL REFERENCES identity.accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, title_media_key)
);

CREATE INDEX idx_playback_progress_activity ON user_state.playback_progress (profile_id, last_activity_at DESC);

CREATE TABLE user_state.media_watch_summary (
  profile_id uuid NOT NULL REFERENCES identity.profiles(id),
  media_key text NOT NULL,
  title_media_key text NOT NULL,
  media_type text NOT NULL CHECK (media_type IN ('movie', 'show', 'season', 'episode')),
  season_number integer NULL,
  episode_number integer NULL,
  effective_watched boolean NOT NULL DEFAULT false,
  play_count integer NOT NULL DEFAULT 0,
  last_watched_at timestamptz NULL,
  last_unwatched_at timestamptz NULL,
  last_activity_at timestamptz NULL,
  source_kind text NOT NULL DEFAULT 'local',
  source_provider text NULL,
  account_id uuid NOT NULL REFERENCES identity.accounts(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, media_key)
);

CREATE INDEX idx_watch_summary_profile_title ON user_state.media_watch_summary (profile_id, title_media_key);

CREATE TABLE user_state.watch_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES identity.accounts(id),
  profile_id uuid NOT NULL REFERENCES identity.profiles(id),
  title_media_key text NOT NULL,
  media_type text NOT NULL CHECK (media_type IN ('movie', 'show')),
  session_kind text NOT NULL DEFAULT 'first_watch' CHECK (session_kind IN ('first_watch', 'rewatch')),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_state.profile_list_items (
  account_id uuid NOT NULL REFERENCES identity.accounts(id),
  profile_id uuid NOT NULL REFERENCES identity.profiles(id),
  list_kind text NOT NULL CHECK (list_kind IN ('watchlist', 'favorites')),
  media_key text NOT NULL CHECK (btrim(media_key) <> ''),
  media_type text NOT NULL CHECK (media_type IN ('movie', 'show')),
  added_at timestamptz NOT NULL DEFAULT now(),
  source_kind text NOT NULL DEFAULT 'local' CHECK (source_kind IN ('local', 'provider_import', 'system')),
  source_provider text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_actor_account_id uuid NULL REFERENCES identity.accounts(id),
  PRIMARY KEY (profile_id, list_kind, media_key)
);

CREATE INDEX idx_list_items_profile_kind ON user_state.profile_list_items (profile_id, list_kind, added_at DESC);

CREATE TABLE user_state.profile_ratings (
  account_id uuid NOT NULL REFERENCES identity.accounts(id),
  profile_id uuid NOT NULL REFERENCES identity.profiles(id),
  media_key text NOT NULL CHECK (btrim(media_key) <> ''),
  media_type text NOT NULL CHECK (media_type IN ('movie', 'show')),
  rating smallint NOT NULL CHECK (rating >= 1 AND rating <= 10),
  rated_at timestamptz NOT NULL DEFAULT now(),
  source_kind text NOT NULL DEFAULT 'local' CHECK (source_kind IN ('local', 'provider_import', 'system')),
  source_provider text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_actor_account_id uuid NULL REFERENCES identity.accounts(id),
  PRIMARY KEY (profile_id, media_key)
);

CREATE INDEX idx_ratings_profile ON user_state.profile_ratings (profile_id, rated_at DESC);

CREATE TABLE user_state.provider_connections (
  account_id uuid NOT NULL REFERENCES identity.accounts(id),
  profile_id uuid NOT NULL REFERENCES identity.profiles(id),
  provider text NOT NULL CHECK (provider IN ('trakt', 'simkl')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('connected', 'reauth_required', 'disconnected', 'pending')),
  provider_account_id text NULL,
  provider_user_id text NULL,
  provider_username text NULL,
  vault_secret_id uuid NULL,
  token_expires_at timestamptz NULL,
  last_refresh_at timestamptz NULL,
  last_refresh_error_code text NULL,
  last_import_completed_at timestamptz NULL,
  disconnected_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, provider)
);

CREATE TABLE user_state.provider_oauth_states (
  state_token_hash text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES identity.accounts(id),
  profile_id uuid NOT NULL REFERENCES identity.profiles(id),
  provider text NOT NULL CHECK (provider IN ('trakt', 'simkl')),
  code_verifier_secret_id uuid NULL,
  return_to text NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_state.provider_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES identity.accounts(id),
  profile_id uuid NOT NULL REFERENCES identity.profiles(id),
  source_provider text NOT NULL CHECK (btrim(source_provider) <> ''),
  provider_user_id text NULL,
  provider_username text NULL,
  provider_import_job_id uuid NULL,
  provider_history_generation integer NULL CHECK (provider_history_generation IS NULL OR provider_history_generation > 0),
  imported_at timestamptz NOT NULL,
  row_count integer NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_import_batches_profile ON user_state.provider_import_batches (account_id, profile_id, imported_at DESC);

-- ============================================================
-- RECOMMENDATION
-- ============================================================

CREATE TABLE recommendation.sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES identity.accounts(id),
  source_key text NOT NULL,
  display_name text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('built_in', 'external', 'account_api', 'reco_engine')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_by_kind text NOT NULL CHECK (created_by_kind IN ('system', 'user', 'pat', 'service')),
  created_by_id text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE recommendation.taste_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES identity.accounts(id),
  profile_id uuid NOT NULL REFERENCES identity.profiles(id),
  source_id uuid NULL REFERENCES recommendation.sources(id),
  source_key text NOT NULL,
  schema_version text NOT NULL DEFAULT '2026-05-01',
  summary text NULL,
  locale text NULL,
  genres jsonb NOT NULL DEFAULT '[]'::jsonb,
  preferred_actors jsonb NOT NULL DEFAULT '[]'::jsonb,
  preferred_directors jsonb NOT NULL DEFAULT '[]'::jsonb,
  content_type_pref jsonb NOT NULL DEFAULT '{}'::jsonb,
  rating_tendency jsonb NOT NULL DEFAULT '{}'::jsonb,
  decade_preferences jsonb NOT NULL DEFAULT '[]'::jsonb,
  signals_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  signal_count integer NOT NULL DEFAULT 0 CHECK (signal_count >= 0 AND signal_count <= 250),
  watching_pace text NULL,
  ai_summary text NULL,
  source text NOT NULL,
  request_hash text NULL,
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
  deleted_at timestamptz NULL,
  created_by_kind text NOT NULL CHECK (created_by_kind IN ('system', 'user', 'pat', 'service')),
  created_by_id text NULL,
  updated_by_kind text NOT NULL CHECK (updated_by_kind IN ('system', 'user', 'pat', 'service')),
  updated_by_id text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE recommendation.taste_profile_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  taste_profile_id uuid NOT NULL REFERENCES recommendation.taste_profiles(id),
  version integer NOT NULL,
  schema_version text NOT NULL,
  summary text NULL,
  locale text NULL,
  signals_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  signal_count integer NOT NULL DEFAULT 0,
  request_hash text NULL,
  actor_kind text NOT NULL CHECK (actor_kind IN ('system', 'user', 'pat', 'service')),
  actor_id text NULL,
  idempotency_key_hash text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE recommendation.recommendation_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES identity.accounts(id),
  profile_id uuid NOT NULL REFERENCES identity.profiles(id),
  source_id uuid NOT NULL REFERENCES recommendation.sources(id),
  list_key text NOT NULL,
  title text NULL,
  description text NULL,
  algorithm_key text NULL,
  model_version text NULL,
  schema_version text NOT NULL DEFAULT '2026-05-01',
  etag text NOT NULL,
  item_count integer NOT NULL CHECK (item_count >= 0 AND item_count <= 500),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
  generated_at timestamptz NULL,
  expires_at timestamptz NULL,
  replaced_at timestamptz NULL,
  deleted_at timestamptz NULL,
  request_hash text NULL,
  created_by_kind text NOT NULL CHECK (created_by_kind IN ('system', 'user', 'pat', 'service')),
  created_by_id text NULL,
  updated_by_kind text NOT NULL CHECK (updated_by_kind IN ('system', 'user', 'pat', 'service')),
  updated_by_id text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE recommendation.recommendation_list_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES recommendation.recommendation_lists(id),
  account_id uuid NOT NULL REFERENCES identity.accounts(id),
  profile_id uuid NOT NULL REFERENCES identity.profiles(id),
  source_id uuid NOT NULL REFERENCES recommendation.sources(id),
  list_key text NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  media_key text NULL,
  media_type text NOT NULL CHECK (media_type IN ('movie', 'show', 'season', 'episode')),
  tmdb_id integer NULL,
  show_tmdb_id integer NULL,
  season_number integer NULL,
  episode_number integer NULL,
  provider_ids jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_ref jsonb NOT NULL DEFAULT '{}'::jsonb,
  score numeric NULL,
  reason_code text NULL,
  reason_public text NULL,
  generated_at timestamptz NULL,
  resolution_status text NOT NULL DEFAULT 'not_attempted' CHECK (resolution_status IN ('not_attempted', 'resolved', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE recommendation.recommendation_list_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES recommendation.recommendation_lists(id),
  version integer NOT NULL,
  schema_version text NOT NULL,
  etag text NOT NULL,
  item_count integer NOT NULL,
  request_hash text NULL,
  actor_kind text NOT NULL CHECK (actor_kind IN ('system', 'user', 'pat', 'service')),
  actor_id text NULL,
  idempotency_key_hash text NULL,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE recommendation.write_idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES identity.accounts(id),
  principal_kind text NOT NULL CHECK (principal_kind IN ('user', 'pat', 'service')),
  principal_id text NOT NULL,
  operation_key text NOT NULL,
  idempotency_key_hash text NOT NULL,
  request_hash text NOT NULL,
  response_status integer NOT NULL,
  response_json jsonb NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE recommendation.outbox_events (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  event_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES identity.accounts(id),
  profile_id uuid NULL REFERENCES identity.profiles(id),
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  event_version integer NOT NULL DEFAULT 1,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_reco_outbox_account ON recommendation.outbox_events (account_id, created_at DESC);
CREATE INDEX idx_reco_outbox_profile ON recommendation.outbox_events (profile_id, created_at DESC);

CREATE TABLE recommendation.runs (
  run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id text NOT NULL,
  purpose text NOT NULL,
  run_type text NOT NULL CHECK (run_type IN ('incremental', 'snapshot', 'backfill', 'full_refresh')),
  status text NOT NULL CHECK (status IN ('queued', 'running', 'paused', 'completed', 'failed', 'cancelled')),
  model_version text NULL,
  algorithm text NULL,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  error jsonb NULL,
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NULL,
  completed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE recommendation.batches (
  batch_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES recommendation.runs(run_id),
  app_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('leased', 'running', 'completed', 'failed', 'cancelled', 'expired')),
  snapshot_id uuid NULL,
  lease_id uuid NULL,
  lease_expires_at timestamptz NULL,
  item_count integer NOT NULL DEFAULT 0 CHECK (item_count >= 0),
  items jsonb NULL,
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  errors jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE recommendation.run_logs (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  run_id uuid NOT NULL REFERENCES recommendation.runs(run_id),
  batch_id uuid NULL REFERENCES recommendation.batches(batch_id),
  level text NOT NULL CHECK (level IN ('debug', 'info', 'warn', 'error')),
  code text NULL,
  message text NOT NULL,
  safe_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE recommendation.backfill_assignments (
  assignment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id text NOT NULL,
  snapshot_id uuid NULL,
  status text NOT NULL CHECK (status IN ('active', 'paused', 'completed', 'cancelled', 'expired')),
  priority integer NOT NULL DEFAULT 0,
  estimated_profile_count integer NOT NULL DEFAULT 0 CHECK (estimated_profile_count >= 0),
  profiles_completed integer NOT NULL DEFAULT 0 CHECK (profiles_completed >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NULL
);

CREATE INDEX idx_reco_backfill_app_status ON recommendation.backfill_assignments (app_id, status, priority DESC);

-- ============================================================
-- READ MODEL
-- ============================================================

CREATE TABLE read_model.profile_episodic_follow_state (
  profile_id uuid NOT NULL REFERENCES identity.profiles(id),
  title_content_id uuid NOT NULL,
  title_media_key text NOT NULL,
  next_episode_air_date date NULL,
  metadata_refreshed_at timestamptz NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  next_episode_media_key text NULL,
  next_episode_season_number integer NULL,
  next_episode_episode_number integer NULL,
  next_episode_absolute_episode_number integer NULL,
  next_episode_title text NULL,
  PRIMARY KEY (profile_id, title_content_id)
);

CREATE INDEX idx_follow_profile_media_key ON read_model.profile_episodic_follow_state (profile_id, title_media_key);
CREATE INDEX idx_follow_next_air ON read_model.profile_episodic_follow_state (next_episode_air_date, profile_id);

-- Profile eligibility projections (previously in public.profile_eligibility_projections, dropped in 0064)
CREATE TABLE read_model.profile_eligibility_projections (
  profile_id uuid PRIMARY KEY REFERENCES identity.profiles(id),
  app_id text NOT NULL,
  last_completed_event_id bigint NOT NULL DEFAULT 0,
  claimed_through_event_id bigint NULL,
  claimed_history_generation integer NULL,
  is_active boolean NOT NULL DEFAULT true,
  eligibility jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_eligibility_app ON read_model.profile_eligibility_projections (app_id, updated_at DESC);

CREATE TABLE read_model.eligible_profile_change_feed (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  app_id text NOT NULL,
  profile_id uuid NOT NULL REFERENCES identity.profiles(id),
  change_type text NOT NULL,
  event_id bigint NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_change_feed_app ON read_model.eligible_profile_change_feed (app_id, id ASC) WHERE created_at > now() - interval '7 days';

CREATE TABLE read_model.eligible_profile_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE read_model.eligible_profile_snapshot_items (
  snapshot_id uuid NOT NULL REFERENCES read_model.eligible_profile_snapshots(id),
  profile_id uuid NOT NULL REFERENCES identity.profiles(id),
  PRIMARY KEY (snapshot_id, profile_id)
);

CREATE TABLE read_model.profile_signal_versions (
  profile_id uuid NOT NULL REFERENCES identity.profiles(id),
  app_id text NOT NULL,
  signal_family text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, app_id, signal_family)
);

CREATE TABLE read_model.profile_input_signal_cache_sections (
  cache_section_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES identity.profiles(id),
  app_id text NOT NULL,
  signal_family text NOT NULL,
  schema_version integer NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX idx_signal_cache_profile ON read_model.profile_input_signal_cache_sections (profile_id, app_id, signal_family);

-- ============================================================
-- Update existing public tables to FK to new identity tables
-- ============================================================

-- service_outbox_events (public) references identity.accounts and identity.profiles
ALTER TABLE public.service_outbox_events
  ADD CONSTRAINT service_outbox_events_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES identity.accounts(id) DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE public.service_outbox_events
  ADD CONSTRAINT service_outbox_events_profile_id_fkey
  FOREIGN KEY (profile_id) REFERENCES identity.profiles(id) DEFERRABLE INITIALLY IMMEDIATE;

-- admin_bulk_job_targets (public) references identity.accounts and identity.profiles
ALTER TABLE public.admin_bulk_job_targets
  ADD CONSTRAINT admin_bulk_job_targets_account_id_fkey
  FOREIGN KEY (account_id) REFERENCES identity.accounts(id) DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE public.admin_bulk_job_targets
  ADD CONSTRAINT admin_bulk_job_targets_profile_id_fkey
  FOREIGN KEY (profile_id) REFERENCES identity.profiles(id) DEFERRABLE INITIALLY IMMEDIATE;

-- profile_episodic_follow_state (public) references identity.profiles
-- Note: this is already in public. Moving to read_model would break code. Keep FK.
ALTER TABLE public.profile_episodic_follow_state
  ADD CONSTRAINT profile_episodic_follow_state_profile_id_fkey
  FOREIGN KEY (profile_id) REFERENCES identity.profiles(id) DEFERRABLE INITIALLY IMMEDIATE;

-- app_audit_events (public) references identity.accounts and identity.profiles (optional FKs)
ALTER TABLE public.app_audit_events
  ADD CONSTRAINT app_audit_events_account_id_fkey
  FOREIGN KEY (account_id) REFERENCES identity.accounts(id) DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE public.app_audit_events
  ADD CONSTRAINT app_audit_events_profile_id_fkey
  FOREIGN KEY (profile_id) REFERENCES identity.profiles(id) DEFERRABLE INITIALLY IMMEDIATE;

-- ============================================================
-- Helper function: bootstrap / upsert account on first JWT login
-- ============================================================

CREATE OR REPLACE FUNCTION identity.upsert_account(
  p_account_id uuid,
  p_email text DEFAULT NULL,
  p_display_name text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO identity.accounts (id, email, display_name)
  VALUES (p_account_id, p_email, p_display_name)
  ON CONFLICT (id) DO UPDATE SET
    email = COALESCE(p_email, identity.accounts.email),
    display_name = COALESCE(p_display_name, identity.accounts.display_name),
    last_seen_at = now(),
    updated_at = now()
  WHERE identity.accounts.deleted_at IS NULL;
END;
$$;
