CREATE TABLE IF NOT EXISTS recommendation_list_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  source text NOT NULL,
  list_key text NOT NULL,
  version integer NOT NULL,
  items_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  item_count integer NOT NULL DEFAULT 0,
  actor_type text NOT NULL,
  actor_id text NOT NULL,
  actor_key_id text,
  purpose text,
  run_id text,
  batch_id text,
  input_versions jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, profile_id, source, list_key, version)
);

CREATE TABLE IF NOT EXISTS recommendation_active_lists (
  account_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  source text NOT NULL,
  list_key text NOT NULL,
  active_version integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  PRIMARY KEY (account_id, profile_id, source, list_key)
);

CREATE TABLE IF NOT EXISTS recommendation_write_idempotency (
  actor_key text NOT NULL,
  operation_key text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  response_body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_key, operation_key, idempotency_key)
);

CREATE TABLE IF NOT EXISTS service_recommendation_batch_idempotency (
  app_id text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (app_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_recommendation_list_versions_profile
  ON recommendation_list_versions (account_id, profile_id, source, list_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_service_recommendation_batch_idempotency_created
  ON service_recommendation_batch_idempotency (created_at DESC);
