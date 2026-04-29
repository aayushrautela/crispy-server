-- Integration API Keys and Recommendation Infrastructure

-- Account API Keys for integration access
CREATE TABLE account_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  name text NOT NULL,
  key_prefix text NOT NULL,
  key_hash text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_by_user_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NULL,
  revoked_at timestamptz NULL,
  revoked_by_user_id uuid NULL,
  rotated_from_key_id uuid NULL REFERENCES account_api_keys(id),
  expires_at timestamptz NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT account_api_keys_status_check
    CHECK (status IN ('active', 'revoked', 'expired'))
);

CREATE UNIQUE INDEX account_api_keys_key_prefix_idx
  ON account_api_keys (key_prefix);

CREATE INDEX account_api_keys_account_id_idx
  ON account_api_keys (account_id);

CREATE INDEX account_api_keys_account_active_idx
  ON account_api_keys (account_id, status)
  WHERE status = 'active';

CREATE INDEX account_api_keys_last_used_at_idx
  ON account_api_keys (last_used_at);

-- Integration Audit Log
CREATE TABLE integration_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  api_key_id uuid NULL REFERENCES account_api_keys(id),
  actor_type text NOT NULL,
  action text NOT NULL,
  route_method text NULL,
  route_path text NULL,
  status_code integer NULL,
  profile_id uuid NULL,
  resource_type text NULL,
  resource_id text NULL,
  request_id text NULL,
  ip_address inet NULL,
  user_agent text NULL,
  error_code text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT integration_audit_actor_type_check
    CHECK (actor_type IN ('user', 'api_key', 'system'))
);

CREATE INDEX integration_audit_account_created_idx
  ON integration_audit_log (account_id, created_at DESC);

CREATE INDEX integration_audit_api_key_created_idx
  ON integration_audit_log (api_key_id, created_at DESC);

CREATE INDEX integration_audit_action_created_idx
  ON integration_audit_log (action, created_at DESC);

CREATE INDEX integration_audit_profile_created_idx
  ON integration_audit_log (profile_id, created_at DESC)
  WHERE profile_id IS NOT NULL;

-- Integration Outbox / Changes Feed
CREATE TABLE integration_outbox_events (
  id bigserial PRIMARY KEY,
  event_id uuid NOT NULL DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  profile_id uuid NULL,
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  event_version integer NOT NULL DEFAULT 1,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT integration_outbox_event_id_unique
    UNIQUE (event_id)
);

CREATE INDEX integration_outbox_account_id_id_idx
  ON integration_outbox_events (account_id, id);

CREATE INDEX integration_outbox_account_profile_id_idx
  ON integration_outbox_events (account_id, profile_id, id)
  WHERE profile_id IS NOT NULL;

CREATE INDEX integration_outbox_event_type_idx
  ON integration_outbox_events (event_type, id);

CREATE UNIQUE INDEX integration_outbox_idempotency_key_idx
  ON integration_outbox_events (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Recommendation Sources
CREATE TABLE recommendation_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  source_key text NOT NULL,
  display_name text NOT NULL,
  source_type text NOT NULL,
  api_key_id uuid NULL REFERENCES account_api_keys(id),
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT recommendation_sources_source_type_check
    CHECK (source_type IN ('built_in', 'external')),

  CONSTRAINT recommendation_sources_status_check
    CHECK (status IN ('active', 'disabled'))
);

CREATE UNIQUE INDEX recommendation_sources_account_source_key_idx
  ON recommendation_sources (account_id, source_key);

CREATE INDEX recommendation_sources_account_status_idx
  ON recommendation_sources (account_id, status);

-- Profile Recommendation Lists
CREATE TABLE profile_recommendation_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  source_id uuid NOT NULL REFERENCES recommendation_sources(id),
  list_key text NOT NULL,
  title text NULL,
  description text NULL,
  algorithm_key text NULL,
  model_version text NULL,
  etag text NOT NULL,
  item_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  generated_at timestamptz NULL,
  expires_at timestamptz NULL,
  replaced_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT profile_recommendation_lists_status_check
    CHECK (status IN ('active', 'deleted')),

  CONSTRAINT profile_recommendation_lists_list_key_check
    CHECK (list_key ~ '^[a-zA-Z0-9._:-]{1,100}$')
);

CREATE UNIQUE INDEX profile_recommendation_lists_unique_active_idx
  ON profile_recommendation_lists (profile_id, source_id, list_key)
  WHERE status = 'active';

CREATE INDEX profile_recommendation_lists_profile_updated_idx
  ON profile_recommendation_lists (profile_id, updated_at DESC);

CREATE INDEX profile_recommendation_lists_account_updated_idx
  ON profile_recommendation_lists (account_id, updated_at DESC);

CREATE INDEX profile_recommendation_lists_source_idx
  ON profile_recommendation_lists (source_id, updated_at DESC);

-- Profile Recommendation List Items
CREATE TABLE profile_recommendation_list_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES profile_recommendation_lists(id) ON DELETE CASCADE,
  account_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  source_id uuid NOT NULL REFERENCES recommendation_sources(id),
  list_key text NOT NULL,
  position integer NOT NULL,
  media_type text NOT NULL,
  canonical_id text NULL,
  provider_ids jsonb NOT NULL DEFAULT '{}'::jsonb,
  series_ref jsonb NULL,
  season_number integer NULL,
  episode_number integer NULL,
  season_provider_ids jsonb NULL,
  episode_provider_ids jsonb NULL,
  metadata_hint jsonb NULL,
  raw_media_ref jsonb NOT NULL,
  score numeric NULL,
  reason text NULL,
  reason_code text NULL,
  generated_at timestamptz NULL,
  resolution_status text NOT NULL DEFAULT 'unresolved',
  resolved_content_id uuid NULL,
  resolved_media_key text NULL,
  resolved_at timestamptz NULL,
  resolution_error text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT profile_recommendation_list_items_position_check
    CHECK (position >= 0),

  CONSTRAINT profile_recommendation_list_items_media_type_check
    CHECK (media_type IN ('movie', 'series', 'season', 'episode')),

  CONSTRAINT profile_recommendation_list_items_resolution_status_check
    CHECK (resolution_status IN ('unresolved', 'resolved', 'failed', 'not_attempted'))
);

CREATE UNIQUE INDEX profile_recommendation_list_items_list_position_idx
  ON profile_recommendation_list_items (list_id, position);

CREATE INDEX profile_recommendation_list_items_profile_list_idx
  ON profile_recommendation_list_items (profile_id, list_key, position);

CREATE INDEX profile_recommendation_list_items_resolution_idx
  ON profile_recommendation_list_items (resolution_status, created_at)
  WHERE resolution_status IN ('unresolved', 'failed');

CREATE INDEX profile_recommendation_list_items_resolved_media_key_idx
  ON profile_recommendation_list_items (resolved_media_key)
  WHERE resolved_media_key IS NOT NULL;

-- Recommendation Write Idempotency
CREATE TABLE recommendation_write_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  source_id uuid NOT NULL REFERENCES recommendation_sources(id),
  list_key text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  response_etag text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT recommendation_write_requests_status_check
    CHECK (status IN ('succeeded', 'failed'))
);

CREATE UNIQUE INDEX recommendation_write_requests_unique_idx
  ON recommendation_write_requests (source_id, profile_id, list_key, idempotency_key);

CREATE INDEX recommendation_write_requests_account_created_idx
  ON recommendation_write_requests (account_id, created_at DESC);
