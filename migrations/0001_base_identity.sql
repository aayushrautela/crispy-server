CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS private;
CREATE SCHEMA IF NOT EXISTS user_state;
CREATE SCHEMA IF NOT EXISTS recommendation;
CREATE SCHEMA IF NOT EXISTS read_model;
CREATE SCHEMA IF NOT EXISTS ops;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE identity.accounts (
  id uuid PRIMARY KEY,
  email text,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX identity_accounts_email_idx ON identity.accounts ((lower(email))) WHERE deleted_at IS NULL AND email IS NOT NULL;
CREATE INDEX identity_accounts_active_seen_idx ON identity.accounts (last_seen_at DESC, updated_at DESC, created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE identity.account_preferences (
  account_id uuid PRIMARY KEY REFERENCES identity.accounts(id) ON DELETE CASCADE,
  settings_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE identity.account_entitlements (
  account_id uuid PRIMARY KEY REFERENCES identity.accounts(id) ON DELETE CASCADE,
  entitlements_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE identity.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES identity.accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  interface_language text NOT NULL DEFAULT 'en',
  region text,
  avatar_key text,
  is_kids boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_by_account_id uuid REFERENCES identity.accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX identity_profiles_account_active_order_idx ON identity.profiles (account_id, sort_order, created_at, id) WHERE deleted_at IS NULL;
CREATE INDEX identity_profiles_active_updated_idx ON identity.profiles (updated_at DESC, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX identity_profiles_admin_page_idx ON identity.profiles (account_id, id) WHERE deleted_at IS NULL;

CREATE TABLE identity.profile_members (
  profile_id uuid NOT NULL REFERENCES identity.profiles(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES identity.accounts(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'owner',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, account_id)
);

CREATE INDEX identity_profile_members_account_idx ON identity.profile_members (account_id, profile_id);

CREATE TABLE identity.profile_preferences (
  profile_id uuid PRIMARY KEY REFERENCES identity.profiles(id) ON DELETE CASCADE,
  settings_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION identity.upsert_account(p_account_id uuid, p_email text DEFAULT NULL, p_display_name text DEFAULT NULL)
RETURNS identity.accounts
LANGUAGE plpgsql
AS $$
DECLARE
  v_account identity.accounts;
BEGIN
  INSERT INTO identity.accounts (id, email, display_name, last_seen_at, updated_at)
  VALUES (p_account_id, p_email, p_display_name, now(), now())
  ON CONFLICT (id) DO UPDATE SET
    email = COALESCE(EXCLUDED.email, identity.accounts.email),
    display_name = COALESCE(EXCLUDED.display_name, identity.accounts.display_name),
    last_seen_at = now(),
    updated_at = now(),
    deleted_at = NULL
  RETURNING * INTO v_account;

  INSERT INTO identity.account_preferences (account_id)
  VALUES (v_account.id)
  ON CONFLICT (account_id) DO NOTHING;

  INSERT INTO identity.account_entitlements (account_id)
  VALUES (v_account.id)
  ON CONFLICT (account_id) DO NOTHING;

  RETURN v_account;
END;
$$;

CREATE TABLE private.account_secrets (
  account_id uuid PRIMARY KEY REFERENCES identity.accounts(id) ON DELETE CASCADE,
  secrets_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX private_account_secrets_gin_idx ON private.account_secrets USING gin (secrets_json);
CREATE INDEX private_account_secrets_updated_idx ON private.account_secrets (updated_at DESC, account_id);

CREATE TABLE private.personal_access_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES identity.accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  token_preview text NOT NULL,
  scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX personal_access_tokens_account_created_idx ON private.personal_access_tokens (account_id, created_at DESC);
CREATE INDEX personal_access_tokens_active_hash_idx ON private.personal_access_tokens (token_hash) WHERE revoked_at IS NULL;

CREATE TABLE content_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE content_provider_refs (
  content_id uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  provider text NOT NULL,
  entity_type text NOT NULL,
  external_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, entity_type, external_id)
);

CREATE INDEX content_provider_refs_content_idx ON content_provider_refs (content_id, provider, entity_type, external_id);

CREATE TABLE content_item_relationships (
  child_content_id uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  parent_content_id uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  relationship_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (child_content_id, relationship_type)
);

CREATE INDEX content_item_relationships_parent_idx ON content_item_relationships (parent_content_id, relationship_type);

CREATE TABLE tmdb_titles (
  media_type text NOT NULL,
  tmdb_id integer NOT NULL,
  language text NOT NULL DEFAULT 'en-US',
  name text NOT NULL,
  original_name text,
  overview text,
  poster_path text,
  backdrop_path text,
  release_date date,
  first_air_date date,
  vote_average numeric,
  vote_count integer,
  popularity numeric,
  adult boolean,
  original_language text,
  genre_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  hydration_level text NOT NULL DEFAULT 'summary',
  fetched_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  PRIMARY KEY (media_type, tmdb_id, language)
);

CREATE INDEX tmdb_titles_name_trgm_idx ON tmdb_titles USING gin (lower(name) gin_trgm_ops);
CREATE INDEX tmdb_titles_original_name_trgm_idx ON tmdb_titles USING gin (lower(original_name) gin_trgm_ops);
CREATE INDEX tmdb_titles_popularity_idx ON tmdb_titles (media_type, popularity DESC);

CREATE TABLE tmdb_external_ids (
  source text NOT NULL,
  external_id text NOT NULL,
  media_type text NOT NULL,
  tmdb_id integer NOT NULL,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, external_id, media_type)
);

CREATE INDEX tmdb_external_ids_tmdb_idx ON tmdb_external_ids (media_type, tmdb_id);

CREATE TABLE tmdb_tv_seasons (
  show_tmdb_id integer NOT NULL,
  season_number integer NOT NULL,
  tmdb_id integer,
  name text,
  overview text,
  poster_path text,
  air_date date,
  episode_count integer,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  PRIMARY KEY (show_tmdb_id, season_number)
);

CREATE TABLE tmdb_tv_episodes (
  show_tmdb_id integer NOT NULL,
  season_number integer NOT NULL,
  episode_number integer NOT NULL,
  tmdb_id integer,
  name text,
  overview text,
  air_date date,
  runtime integer,
  still_path text,
  vote_average numeric,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  PRIMARY KEY (show_tmdb_id, season_number, episode_number)
);

CREATE INDEX tmdb_tv_episodes_tmdb_idx ON tmdb_tv_episodes (tmdb_id);

CREATE TABLE tmdb_api_responses (
  cache_key text PRIMARY KEY,
  resource_type text NOT NULL,
  resource_id text,
  variant text,
  language text,
  request_path text NOT NULL,
  request_query jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_json jsonb NOT NULL,
  status_code integer NOT NULL DEFAULT 200,
  is_negative boolean NOT NULL DEFAULT false,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  fresh_until timestamptz NOT NULL,
  stale_until timestamptz NOT NULL,
  purge_at timestamptz NOT NULL,
  last_error text,
  error_count integer NOT NULL DEFAULT 0
);

CREATE INDEX tmdb_api_responses_purge_idx ON tmdb_api_responses (purge_at);
CREATE INDEX tmdb_api_responses_resource_idx ON tmdb_api_responses (resource_type, resource_id, variant, language);

CREATE TABLE tmdb_people (
  tmdb_id integer PRIMARY KEY,
  name text NOT NULL,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);

CREATE TABLE tmdb_collections (
  tmdb_id integer PRIMARY KEY,
  name text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);

CREATE TABLE tmdb_search_cache (
  cache_key text PRIMARY KEY,
  query text NOT NULL,
  media_types text[] NOT NULL DEFAULT '{}',
  language text NOT NULL DEFAULT 'en-US',
  results jsonb NOT NULL DEFAULT '[]'::jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE imdb_ratings (
  imdb_id text PRIMARY KEY,
  rating numeric,
  votes integer,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE watch_media_card_cache (
  item_id uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  language text NOT NULL DEFAULT 'en-US',
  media_type text NOT NULL,
  title_provider text,
  title_provider_id text,
  title_media_type text,
  title text NOT NULL,
  subtitle text,
  poster_url text,
  backdrop_url text,
  still_url text,
  logo_url text,
  trailer_url text,
  trailer_thumbnail_url text,
  poster_color text,
  backdrop_color text,
  release_year integer,
  rating numeric,
  maturity_rating text,
  genres jsonb NOT NULL DEFAULT '[]'::jsonb,
  overview text,
  runtime_minutes integer,
  release_date date,
  status text,
  episode_title text,
  episode_air_date date,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, language)
);

CREATE TABLE user_state.provider_sessions (
  profile_id uuid NOT NULL REFERENCES identity.profiles(id) ON DELETE CASCADE,
  provider text NOT NULL,
  state text NOT NULL,
  provider_user_id text,
  external_username text,
  credentials_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  state_token text,
  expires_at timestamptz,
  last_refresh_at timestamptz,
  last_refresh_error text,
  last_import_completed_at timestamptz,
  disconnected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, provider)
);

CREATE INDEX provider_sessions_pending_idx ON user_state.provider_sessions (provider, state, state_token) WHERE state = 'oauth_pending';
CREATE INDEX provider_sessions_updated_idx ON user_state.provider_sessions (updated_at DESC, created_at DESC);

CREATE TABLE user_state.provider_import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES identity.profiles(id) ON DELETE CASCADE,
  profile_group_id uuid,
  provider text NOT NULL,
  mode text NOT NULL DEFAULT 'replace_import',
  status text NOT NULL,
  requested_by_user_id uuid,
  checkpoint_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX provider_import_jobs_profile_created_idx ON user_state.provider_import_jobs (profile_id, created_at DESC, id);
CREATE INDEX provider_import_jobs_admin_idx ON user_state.provider_import_jobs (created_at DESC, provider, status, id);
CREATE INDEX provider_import_jobs_pending_idx ON user_state.provider_import_jobs (profile_id, provider, created_at DESC) WHERE status = 'oauth_pending';

CREATE TABLE user_state.profile_watch_data_state (
  profile_id uuid PRIMARY KEY REFERENCES identity.profiles(id) ON DELETE CASCADE,
  history_generation integer NOT NULL DEFAULT 0,
  current_origin text,
  last_import_provider text,
  last_import_job_id uuid,
  last_reset_at timestamptz,
  last_import_completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_state.playback_progress (
  account_id uuid REFERENCES identity.accounts(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES identity.profiles(id) ON DELETE CASCADE,
  title_item_id uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  playable_item_id uuid REFERENCES content_items(id) ON DELETE SET NULL,
  media_type text NOT NULL,
  position_seconds integer,
  duration_seconds integer,
  progress_bps integer,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  dismissed_at timestamptz,
  source_kind text,
  source_provider text,
  last_actor_account_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, title_item_id)
);

CREATE INDEX playback_progress_continue_idx ON user_state.playback_progress (profile_id, last_activity_at DESC) WHERE dismissed_at IS NULL;
CREATE INDEX playback_progress_source_idx ON user_state.playback_progress (profile_id, source_provider, source_kind);

CREATE TABLE user_state.profile_list_items (
  account_id uuid REFERENCES identity.accounts(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES identity.profiles(id) ON DELETE CASCADE,
  list_kind text NOT NULL,
  item_id uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  media_type text NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  source_kind text,
  source_provider text,
  last_actor_account_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, list_kind, item_id)
);

CREATE INDEX profile_list_items_feed_idx ON user_state.profile_list_items (profile_id, list_kind, added_at DESC);
CREATE INDEX profile_list_items_source_idx ON user_state.profile_list_items (profile_id, source_provider, source_kind);

CREATE TABLE user_state.profile_ratings (
  account_id uuid REFERENCES identity.accounts(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES identity.profiles(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  media_type text NOT NULL,
  rating numeric NOT NULL,
  rated_at timestamptz NOT NULL DEFAULT now(),
  source_kind text,
  source_provider text,
  last_actor_account_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, item_id)
);

CREATE INDEX profile_ratings_profile_rated_idx ON user_state.profile_ratings (profile_id, rated_at DESC);
CREATE INDEX profile_ratings_source_idx ON user_state.profile_ratings (profile_id, source_provider, source_kind);

CREATE TABLE user_state.watch_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid REFERENCES identity.accounts(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES identity.profiles(id) ON DELETE CASCADE,
  item_id uuid REFERENCES content_items(id) ON DELETE SET NULL,
  title_item_id uuid REFERENCES content_items(id) ON DELETE SET NULL,
  media_type text NOT NULL,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  position_seconds integer,
  duration_seconds integer,
  progress_bps integer,
  source_kind text,
  source_provider text,
  last_actor_account_id uuid,
  client_event_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX watch_events_profile_history_idx ON user_state.watch_events (profile_id, occurred_at DESC);
CREATE INDEX watch_events_completed_episode_idx ON user_state.watch_events (profile_id, occurred_at DESC) WHERE media_type = 'episode' AND event_type = 'playback_completed';
CREATE INDEX watch_events_source_idx ON user_state.watch_events (profile_id, source_provider, source_kind);
CREATE UNIQUE INDEX watch_events_client_event_idx ON user_state.watch_events (profile_id, client_event_id) WHERE client_event_id IS NOT NULL;

CREATE TABLE user_state.media_watch_summary (
  account_id uuid REFERENCES identity.accounts(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES identity.profiles(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  title_item_id uuid REFERENCES content_items(id) ON DELETE SET NULL,
  media_type text NOT NULL,
  effective_watched boolean NOT NULL DEFAULT false,
  play_count integer NOT NULL DEFAULT 0,
  last_watched_at timestamptz,
  last_unwatched_at timestamptz,
  last_activity_at timestamptz,
  source_kind text,
  source_provider text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, item_id)
);

CREATE INDEX media_watch_summary_profile_activity_idx ON user_state.media_watch_summary (profile_id, last_activity_at DESC);
CREATE INDEX media_watch_summary_source_idx ON user_state.media_watch_summary (profile_id, source_provider, source_kind);

CREATE TABLE user_state.watch_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid REFERENCES identity.accounts(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES identity.profiles(id) ON DELETE CASCADE,
  item_id uuid REFERENCES content_items(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE taste_profiles (
  profile_id uuid NOT NULL REFERENCES identity.profiles(id) ON DELETE CASCADE,
  source_key text NOT NULL,
  genres jsonb NOT NULL DEFAULT '[]'::jsonb,
  preferred_actors jsonb NOT NULL DEFAULT '[]'::jsonb,
  preferred_directors jsonb NOT NULL DEFAULT '[]'::jsonb,
  content_type_pref jsonb NOT NULL DEFAULT '{}'::jsonb,
  rating_tendency jsonb NOT NULL DEFAULT '{}'::jsonb,
  decade_preferences jsonb NOT NULL DEFAULT '[]'::jsonb,
  watching_pace text,
  ai_summary text,
  source text NOT NULL DEFAULT 'unknown',
  updated_by_kind text NOT NULL DEFAULT 'service',
  updated_by_id uuid,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, source_key)
);

CREATE INDEX taste_profiles_profile_updated_idx ON taste_profiles (profile_id, updated_at DESC, source_key);

CREATE TABLE recommendation_snapshots (
  profile_id uuid NOT NULL REFERENCES identity.profiles(id) ON DELETE CASCADE,
  source_key text NOT NULL,
  history_generation integer NOT NULL DEFAULT 0,
  algorithm_version text NOT NULL,
  source_cursor text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  source text NOT NULL DEFAULT 'unknown',
  updated_by_kind text NOT NULL DEFAULT 'service',
  updated_by_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, source_key, algorithm_version)
);

CREATE INDEX recommendation_snapshots_profile_generated_idx ON recommendation_snapshots (profile_id, generated_at DESC, source_key, algorithm_version);

CREATE TABLE recommendation_event_outbox (
  id bigserial PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES identity.profiles(id) ON DELETE CASCADE,
  history_generation integer NOT NULL DEFAULT 0,
  event_type text NOT NULL,
  media_key text,
  media_type text,
  provider text,
  provider_id text,
  parent_provider text,
  parent_provider_id text,
  tmdb_id integer,
  show_tmdb_id integer,
  season_number integer,
  episode_number integer,
  absolute_episode_number integer,
  rating numeric,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX recommendation_event_outbox_undelivered_idx ON recommendation_event_outbox (occurred_at, id) WHERE delivered_at IS NULL;
CREATE INDEX recommendation_event_outbox_profile_idx ON recommendation_event_outbox (profile_id);

CREATE TABLE recommendation_write_idempotency (
  actor_key text NOT NULL,
  operation_key text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  response_body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_key, operation_key, idempotency_key)
);

CREATE TABLE recommendation_list_versions (
  account_id uuid NOT NULL REFERENCES identity.accounts(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES identity.profiles(id) ON DELETE CASCADE,
  source text NOT NULL,
  list_key text NOT NULL,
  version integer NOT NULL,
  title text NOT NULL,
  subtitle text,
  section_type text NOT NULL DEFAULT 'standard',
  items_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  item_count integer NOT NULL DEFAULT 0,
  actor_type text NOT NULL,
  actor_id text,
  actor_key_id text,
  purpose text,
  run_id uuid,
  batch_id uuid,
  input_versions jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, profile_id, source, list_key, version)
);

CREATE INDEX recommendation_list_versions_lookup_idx ON recommendation_list_versions (account_id, profile_id, source, list_key, version DESC);
CREATE INDEX recommendation_list_versions_created_idx ON recommendation_list_versions (created_at DESC);

CREATE TABLE recommendation_active_lists (
  account_id uuid NOT NULL REFERENCES identity.accounts(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES identity.profiles(id) ON DELETE CASCADE,
  source text NOT NULL,
  list_key text NOT NULL,
  active_version integer NOT NULL,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, profile_id, source, list_key)
);

CREATE TABLE account_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES identity.accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  key_prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active',
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_by_user_id uuid,
  rotated_from_key_id uuid,
  expires_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX account_api_keys_prefix_active_idx ON account_api_keys (key_prefix, status, expires_at);
CREATE INDEX account_api_keys_account_created_idx ON account_api_keys (account_id, created_at DESC);

CREATE TABLE recommendation_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES identity.accounts(id) ON DELETE CASCADE,
  source_key text NOT NULL,
  display_name text NOT NULL,
  source_type text NOT NULL DEFAULT 'external',
  api_key_id uuid REFERENCES account_api_keys(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, source_key)
);

CREATE INDEX recommendation_sources_account_status_idx ON recommendation_sources (account_id, status, source_key);

CREATE TABLE profile_recommendation_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES identity.accounts(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES identity.profiles(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES recommendation_sources(id) ON DELETE CASCADE,
  list_key text NOT NULL,
  title text NOT NULL,
  description text,
  algorithm_key text,
  model_version text,
  etag text,
  item_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  generated_at timestamptz,
  expires_at timestamptz,
  replaced_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX profile_recommendation_lists_active_uidx ON profile_recommendation_lists (profile_id, source_id, list_key) WHERE status = 'active';
CREATE INDEX profile_recommendation_lists_account_idx ON profile_recommendation_lists (account_id, profile_id, status, source_id, list_key);
CREATE INDEX profile_recommendation_lists_updated_idx ON profile_recommendation_lists (updated_at DESC, list_key);

CREATE TABLE profile_recommendation_list_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES profile_recommendation_lists(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES identity.accounts(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES identity.profiles(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES recommendation_sources(id) ON DELETE CASCADE,
  list_key text NOT NULL,
  position integer NOT NULL,
  media_type text NOT NULL,
  canonical_id text,
  provider_ids jsonb NOT NULL DEFAULT '{}'::jsonb,
  series_ref jsonb,
  season_number integer,
  episode_number integer,
  season_provider_ids jsonb NOT NULL DEFAULT '{}'::jsonb,
  episode_provider_ids jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata_hint jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_media_ref jsonb NOT NULL DEFAULT '{}'::jsonb,
  score double precision,
  reason text,
  reason_code text,
  generated_at timestamptz,
  resolution_status text NOT NULL DEFAULT 'pending',
  resolved_content_id text,
  resolved_media_key text,
  resolved_at timestamptz,
  resolution_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX profile_recommendation_list_items_list_position_idx ON profile_recommendation_list_items (list_id, position);
CREATE INDEX profile_recommendation_list_items_profile_idx ON profile_recommendation_list_items (profile_id, source_id, list_key);

CREATE TABLE recommendation_write_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES identity.accounts(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES identity.profiles(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES recommendation_sources(id) ON DELETE CASCADE,
  list_key text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  response_etag text,
  status text NOT NULL DEFAULT 'succeeded',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, profile_id, list_key, idempotency_key)
);

CREATE INDEX recommendation_write_requests_account_idx ON recommendation_write_requests (account_id, profile_id, source_id, list_key, created_at DESC);

CREATE TABLE integration_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid REFERENCES identity.accounts(id) ON DELETE SET NULL,
  profile_id uuid REFERENCES identity.profiles(id) ON DELETE SET NULL,
  api_key_id uuid REFERENCES account_api_keys(id) ON DELETE SET NULL,
  action text NOT NULL,
  status text NOT NULL,
  ip_address text,
  user_agent text,
  request_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX integration_audit_log_account_created_idx ON integration_audit_log (account_id, created_at DESC);
CREATE INDEX integration_audit_log_profile_created_idx ON integration_audit_log (profile_id, created_at DESC);

CREATE TABLE integration_outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid REFERENCES identity.accounts(id) ON DELETE CASCADE,
  profile_id uuid REFERENCES identity.profiles(id) ON DELETE CASCADE,
  source_id uuid REFERENCES recommendation_sources(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX integration_outbox_events_pending_idx ON integration_outbox_events (available_at, created_at) WHERE status = 'pending';
CREATE INDEX integration_outbox_events_profile_idx ON integration_outbox_events (profile_id, created_at DESC);

CREATE TABLE public_account_taste_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES identity.accounts(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES identity.profiles(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'account_api',
  schema_version integer NOT NULL DEFAULT 1,
  summary text,
  locale text,
  signals_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  signal_count integer NOT NULL DEFAULT 0,
  request_hash text,
  version integer NOT NULL DEFAULT 1,
  idempotency_key_hash text,
  created_by_type text,
  created_by_id text,
  updated_by_type text,
  updated_by_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX public_account_taste_profiles_active_uidx ON public_account_taste_profiles (account_id, profile_id, source) WHERE deleted_at IS NULL;
CREATE INDEX public_account_taste_profiles_profile_idx ON public_account_taste_profiles (profile_id, updated_at DESC);

CREATE TABLE public_account_taste_profile_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  taste_profile_id uuid NOT NULL REFERENCES public_account_taste_profiles(id) ON DELETE CASCADE,
  version integer NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  summary text,
  locale text,
  signals_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  signal_count integer NOT NULL DEFAULT 0,
  request_hash text,
  actor_type text,
  actor_id text,
  idempotency_key_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (taste_profile_id, version)
);

CREATE TABLE public_account_write_idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES identity.accounts(id) ON DELETE CASCADE,
  principal_type text NOT NULL,
  principal_id text NOT NULL,
  operation_key text NOT NULL,
  idempotency_key_hash text NOT NULL,
  request_hash text NOT NULL,
  response_status integer NOT NULL,
  response_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, principal_type, principal_id, operation_key, idempotency_key_hash)
);

CREATE INDEX public_account_write_idempotency_expiry_idx ON public_account_write_idempotency_keys (expires_at);

CREATE TABLE public_account_write_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid REFERENCES identity.accounts(id) ON DELETE SET NULL,
  profile_id uuid REFERENCES identity.profiles(id) ON DELETE SET NULL,
  principal_type text,
  principal_id text,
  operation_key text,
  status text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX public_account_write_audit_events_account_idx ON public_account_write_audit_events (account_id, created_at DESC);

CREATE TABLE app_registry (
  app_id text PRIMARY KEY,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'active',
  owner_team text,
  allowed_environments text[] NOT NULL DEFAULT '{}',
  principal_type text NOT NULL DEFAULT 'app',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz
);

CREATE TABLE app_scopes (
  app_id text NOT NULL REFERENCES app_registry(app_id) ON DELETE CASCADE,
  scope text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (app_id, scope)
);

CREATE INDEX app_scopes_active_idx ON app_scopes (app_id, scope) WHERE status = 'active';

CREATE TABLE app_source_ownership (
  source text PRIMARY KEY,
  app_id text NOT NULL REFERENCES app_registry(app_id) ON DELETE CASCADE,
  allowed_list_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX app_source_ownership_app_idx ON app_source_ownership (app_id, status, source);

CREATE TABLE app_rate_limit_policies (
  app_id text PRIMARY KEY REFERENCES app_registry(app_id) ON DELETE CASCADE,
  profile_changes_reads_per_minute integer NOT NULL DEFAULT 60,
  profile_signal_reads_per_minute integer NOT NULL DEFAULT 60,
  recommendation_writes_per_minute integer NOT NULL DEFAULT 60,
  batch_writes_per_minute integer NOT NULL DEFAULT 10,
  config_bundle_reads_per_minute integer NOT NULL DEFAULT 60,
  runs_per_hour integer NOT NULL DEFAULT 60,
  snapshots_per_day integer NOT NULL DEFAULT 24,
  max_profiles_per_batch integer NOT NULL DEFAULT 1000,
  max_items_per_list integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app_keys (
  key_id text PRIMARY KEY,
  app_id text NOT NULL REFERENCES app_registry(app_id) ON DELETE CASCADE,
  key_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  last_used_at timestamptz,
  rotation_group text,
  allowed_ip_cidrs text[] NOT NULL DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  disabled_at timestamptz,
  revoked_at timestamptz
);

CREATE INDEX app_keys_app_status_idx ON app_keys (app_id, status, expires_at);

CREATE TABLE app_grants (
  grant_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id text NOT NULL REFERENCES app_registry(app_id) ON DELETE CASCADE,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  purpose text NOT NULL,
  actions text[] NOT NULL DEFAULT '{}',
  constraints jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);

CREATE INDEX app_grants_active_idx ON app_grants (app_id, status, expires_at, created_at);

CREATE TABLE app_audit_events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id text NOT NULL,
  key_id text,
  action text NOT NULL,
  account_id uuid,
  profile_id uuid,
  run_id uuid,
  batch_id uuid,
  resource_type text,
  resource_id text,
  request_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX app_audit_events_app_cursor_idx ON app_audit_events (app_id, created_at DESC, event_id DESC);
CREATE INDEX app_audit_events_profile_idx ON app_audit_events (profile_id, created_at DESC);
CREATE INDEX app_audit_events_run_idx ON app_audit_events (run_id, batch_id, created_at DESC);

CREATE TABLE profile_eligibility_projections (
  account_id uuid NOT NULL REFERENCES identity.accounts(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES identity.profiles(id) ON DELETE CASCADE,
  purpose text NOT NULL,
  eligible boolean NOT NULL DEFAULT false,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  eligibility_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, profile_id, purpose)
);

CREATE INDEX profile_eligibility_purpose_idx ON profile_eligibility_projections (purpose, eligible, account_id, profile_id);
CREATE INDEX profile_eligibility_profile_idx ON profile_eligibility_projections (profile_id, purpose);

CREATE TABLE profile_signal_versions (
  account_id uuid NOT NULL REFERENCES identity.accounts(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES identity.profiles(id) ON DELETE CASCADE,
  signals_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, profile_id)
);

CREATE TABLE profile_input_signal_cache_sections (
  account_id uuid NOT NULL REFERENCES identity.accounts(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES identity.profiles(id) ON DELETE CASCADE,
  signal_family text NOT NULL,
  schema_version integer NOT NULL,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  item_count integer NOT NULL DEFAULT 0,
  limit_coverage integer,
  materialized_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  source_version integer,
  source_latest_updated_at timestamptz,
  is_complete boolean NOT NULL DEFAULT true,
  empty_kind text,
  generation_reason text,
  invalidated_at timestamptz,
  invalidation_reason text,
  refresh_completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, profile_id, signal_family, schema_version)
);

CREATE INDEX profile_input_signal_cache_profile_idx ON profile_input_signal_cache_sections (account_id, profile_id, schema_version, signal_family);
CREATE INDEX profile_input_signal_cache_expiry_idx ON profile_input_signal_cache_sections (expires_at);

CREATE TABLE profile_language_profiles (
  profile_id uuid PRIMARY KEY REFERENCES identity.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  window_size integer NOT NULL DEFAULT 0,
  sample_size integer NOT NULL DEFAULT 0,
  ratios jsonb NOT NULL DEFAULT '{}'::jsonb,
  primary_language text,
  computed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX profile_language_profiles_ready_idx ON profile_language_profiles (profile_id) WHERE status = 'ready';

CREATE TABLE eligible_profile_snapshots (
  snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id text NOT NULL,
  purpose text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text,
  requested_by jsonb NOT NULL DEFAULT '{}'::jsonb,
  estimated_profile_count integer NOT NULL DEFAULT 0,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX eligible_profile_snapshots_app_idx ON eligible_profile_snapshots (app_id, created_at DESC);

CREATE TABLE eligible_profile_snapshot_items (
  snapshot_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL REFERENCES eligible_profile_snapshots(snapshot_id) ON DELETE CASCADE,
  item_offset integer NOT NULL,
  account_id uuid NOT NULL REFERENCES identity.accounts(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES identity.profiles(id) ON DELETE CASCADE,
  eligibility_version integer NOT NULL,
  signals_version integer NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  lease_id uuid,
  lease_expires_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (snapshot_id, account_id, profile_id)
);

CREATE INDEX eligible_profile_snapshot_items_lease_idx ON eligible_profile_snapshot_items (snapshot_id, status, item_offset);
CREATE INDEX eligible_profile_snapshot_items_profile_idx ON eligible_profile_snapshot_items (snapshot_id, account_id, profile_id);

CREATE TABLE eligible_profile_change_feed (
  sequence bigserial UNIQUE,
  change_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES identity.accounts(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES identity.profiles(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  eligible boolean NOT NULL,
  eligibility_version integer NOT NULL,
  signals_version integer NOT NULL,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommended_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  changed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX eligible_profile_change_feed_sequence_idx ON eligible_profile_change_feed (sequence);
CREATE INDEX eligible_profile_change_feed_filters_idx ON eligible_profile_change_feed (event_type, account_id, profile_id, sequence);

CREATE TABLE eligible_profile_change_checkpoints (
  app_id text NOT NULL,
  consumer_id text NOT NULL DEFAULT '',
  sequence bigint NOT NULL DEFAULT 0,
  cursor text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (app_id, consumer_id)
);

CREATE TABLE service_recommendation_batch_idempotency (
  app_id text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (app_id, idempotency_key)
);

CREATE TABLE app_recommendation_runs (
  run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id text NOT NULL,
  purpose text NOT NULL,
  run_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  model_version text,
  algorithm text,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  error jsonb,
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX app_recommendation_runs_app_status_idx ON app_recommendation_runs (app_id, status, created_at DESC);

CREATE TABLE app_recommendation_batches (
  batch_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES app_recommendation_runs(run_id) ON DELETE CASCADE,
  app_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  snapshot_id uuid,
  lease_id uuid,
  lease_expires_at timestamptz,
  item_count integer NOT NULL DEFAULT 0,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX app_recommendation_batches_run_idx ON app_recommendation_batches (app_id, run_id, batch_id);
CREATE INDEX app_recommendation_batches_status_idx ON app_recommendation_batches (app_id, status, created_at DESC);

CREATE TABLE app_recommendation_backfill_assignments (
  assignment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id text NOT NULL,
  snapshot_id uuid,
  status text NOT NULL DEFAULT 'pending',
  priority integer NOT NULL DEFAULT 0,
  estimated_profile_count integer NOT NULL DEFAULT 0,
  profiles_completed integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);

CREATE INDEX app_recommendation_backfill_list_idx ON app_recommendation_backfill_assignments (app_id, status, priority DESC, created_at ASC);

CREATE TABLE ai_insights_cache (
  content_id uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  locale text NOT NULL DEFAULT 'en-US',
  generation_version text NOT NULL,
  model_name text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_by_profile_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (content_id, locale, generation_version)
);

CREATE TABLE service_outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  event_version integer NOT NULL DEFAULT 1,
  aggregate_type text,
  aggregate_id text,
  user_id uuid,
  profile_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz,
  locked_until timestamptz,
  destination text,
  correlation_id text,
  bulk_job_id uuid,
  bulk_job_target_id uuid,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX service_outbox_events_claim_idx ON service_outbox_events (available_at, occurred_at, id) WHERE status = 'pending';
CREATE INDEX service_outbox_events_locked_idx ON service_outbox_events (locked_until, id) WHERE status = 'processing';
CREATE INDEX service_outbox_events_diagnostics_idx ON service_outbox_events (event_type, created_at DESC, id DESC);
CREATE INDEX service_outbox_events_profile_idx ON service_outbox_events (profile_id, created_at DESC);
CREATE UNIQUE INDEX service_outbox_events_idempotency_uidx ON service_outbox_events (idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE admin_bulk_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  requested_by text,
  request jsonb NOT NULL DEFAULT '{}'::jsonb,
  counters jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  error jsonb
);

CREATE INDEX admin_bulk_jobs_status_created_idx ON admin_bulk_jobs (status, created_at DESC);

CREATE TABLE admin_bulk_job_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bulk_job_id uuid NOT NULL REFERENCES admin_bulk_jobs(id) ON DELETE CASCADE,
  account_id uuid,
  profile_id uuid,
  status text NOT NULL DEFAULT 'pending',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts integer NOT NULL DEFAULT 0,
  error jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX admin_bulk_job_targets_job_status_idx ON admin_bulk_job_targets (bulk_job_id, status, created_at);
CREATE INDEX admin_bulk_job_targets_profile_idx ON admin_bulk_job_targets (profile_id);

CREATE TABLE admin_bulk_job_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bulk_job_id uuid REFERENCES admin_bulk_jobs(id) ON DELETE SET NULL,
  idempotency_key text,
  dedupe_key text,
  request jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX admin_bulk_job_requests_idempotency_uidx ON admin_bulk_job_requests (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX admin_bulk_job_requests_dedupe_idx ON admin_bulk_job_requests (dedupe_key, created_at DESC);

CREATE TABLE admin_bulk_job_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bulk_job_id uuid NOT NULL REFERENCES admin_bulk_jobs(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX admin_bulk_job_events_job_created_idx ON admin_bulk_job_events (bulk_job_id, created_at DESC);

CREATE TABLE recommendation.runs (
  run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id text,
  purpose text,
  run_type text,
  status text NOT NULL DEFAULT 'pending',
  model_version text,
  algorithm text,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  error jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX recommendation_runs_status_created_idx ON recommendation.runs (status, created_at DESC);
CREATE INDEX recommendation_runs_created_idx ON recommendation.runs (created_at DESC);

CREATE TABLE recommendation.batches (
  batch_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES recommendation.runs(run_id) ON DELETE CASCADE,
  app_id text,
  status text NOT NULL DEFAULT 'pending',
  snapshot_id uuid,
  lease_id uuid,
  lease_expires_at timestamptz,
  item_count integer NOT NULL DEFAULT 0,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX recommendation_batches_run_created_idx ON recommendation.batches (run_id, created_at DESC);

CREATE TABLE recommendation.run_logs (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES recommendation.runs(run_id) ON DELETE CASCADE,
  batch_id uuid,
  level text NOT NULL,
  code text,
  message text NOT NULL,
  safe_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX recommendation_run_logs_run_created_idx ON recommendation.run_logs (run_id, created_at DESC);

CREATE TABLE recommendation.backfill_assignments (
  assignment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id text,
  snapshot_id uuid,
  status text NOT NULL DEFAULT 'pending',
  priority integer NOT NULL DEFAULT 0,
  estimated_profile_count integer NOT NULL DEFAULT 0,
  profiles_completed integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);

CREATE TABLE ops.identity_v2_migration_audit (
  id bigserial PRIMARY KEY,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
