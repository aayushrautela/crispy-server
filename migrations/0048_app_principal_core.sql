-- Privileged app principal core

CREATE TABLE app_registry (
  app_id text PRIMARY KEY,
  name text NOT NULL,
  description text NULL,
  status text NOT NULL DEFAULT 'active',
  owner_team text NOT NULL,
  allowed_environments text[] NOT NULL DEFAULT ARRAY[]::text[],
  principal_type text NOT NULL DEFAULT 'service_app',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz NULL,

  CONSTRAINT app_registry_status_check
    CHECK (status IN ('active', 'disabled', 'deleted')),
  CONSTRAINT app_registry_principal_type_check
    CHECK (principal_type IN ('service_app'))
);

CREATE TABLE app_keys (
  key_id text PRIMARY KEY,
  app_id text NOT NULL REFERENCES app_registry(app_id),
  key_hash text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NULL,
  last_used_at timestamptz NULL,
  disabled_at timestamptz NULL,
  revoked_at timestamptz NULL,
  rotation_group text NULL,
  allowed_ip_cidrs text[] NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT app_keys_status_check
    CHECK (status IN ('active', 'disabled', 'expired', 'revoked'))
);

CREATE INDEX app_keys_app_id_idx ON app_keys (app_id);
CREATE INDEX app_keys_app_active_idx ON app_keys (app_id, status) WHERE status = 'active';

CREATE TABLE app_scopes (
  app_id text NOT NULL REFERENCES app_registry(app_id),
  scope text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (app_id, scope),
  CONSTRAINT app_scopes_status_check
    CHECK (status IN ('active', 'disabled'))
);

CREATE TABLE app_grants (
  grant_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id text NOT NULL REFERENCES app_registry(app_id),
  resource_type text NOT NULL,
  resource_id text NOT NULL DEFAULT '*',
  purpose text NOT NULL,
  actions text[] NOT NULL,
  constraints jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NULL,

  CONSTRAINT app_grants_status_check
    CHECK (status IN ('active', 'disabled', 'expired')),
  CONSTRAINT app_grants_resource_type_check
    CHECK (resource_type IN ('profileSignals', 'aiConfig', 'recommendationList', 'profileEligibility', 'recommendationRun', 'recommendationBatch', 'auditEvents')),
  CONSTRAINT app_grants_purpose_check
    CHECK (purpose IN ('recommendation-generation'))
);

CREATE INDEX app_grants_app_active_idx
  ON app_grants (app_id, resource_type, purpose, status)
  WHERE status = 'active';

CREATE TABLE app_source_ownership (
  source text PRIMARY KEY,
  app_id text NOT NULL REFERENCES app_registry(app_id),
  allowed_list_keys text[] NOT NULL DEFAULT ARRAY[]::text[],
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT app_source_ownership_status_check
    CHECK (status IN ('active', 'disabled'))
);

CREATE INDEX app_source_ownership_app_idx ON app_source_ownership (app_id, status);

CREATE TABLE app_rate_limit_policies (
  app_id text PRIMARY KEY REFERENCES app_registry(app_id),
  profile_changes_reads_per_minute integer NOT NULL DEFAULT 60,
  profile_signal_reads_per_minute integer NOT NULL DEFAULT 120,
  recommendation_writes_per_minute integer NOT NULL DEFAULT 60,
  batch_writes_per_minute integer NOT NULL DEFAULT 20,
  config_bundle_reads_per_minute integer NOT NULL DEFAULT 60,
  runs_per_hour integer NOT NULL DEFAULT 10,
  snapshots_per_day integer NOT NULL DEFAULT 5,
  max_profiles_per_batch integer NOT NULL DEFAULT 500,
  max_items_per_list integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app_audit_events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id text NOT NULL,
  key_id text NULL,
  action text NOT NULL,
  account_id uuid NULL,
  profile_id uuid NULL,
  run_id text NULL,
  batch_id text NULL,
  resource_type text NULL,
  resource_id text NULL,
  request_id text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX app_audit_events_app_created_idx ON app_audit_events (app_id, created_at DESC);
CREATE INDEX app_audit_events_account_created_idx ON app_audit_events (app_id, account_id, created_at DESC) WHERE account_id IS NOT NULL;
CREATE INDEX app_audit_events_profile_created_idx ON app_audit_events (app_id, profile_id, created_at DESC) WHERE profile_id IS NOT NULL;
CREATE INDEX app_audit_events_run_created_idx ON app_audit_events (app_id, run_id, created_at DESC) WHERE run_id IS NOT NULL;
