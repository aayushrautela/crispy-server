CREATE TABLE IF NOT EXISTS admin_bulk_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation text NOT NULL,
  scope_type text NOT NULL,
  tier text NULL,
  status text NOT NULL DEFAULT 'queued',
  requested_by_admin_id text NULL,
  request_correlation_id text NULL,
  dedupe_key text NOT NULL,
  idempotency_key text NULL,
  reason text NULL,
  target_count_estimate integer NULL,
  targets_total integer NOT NULL DEFAULT 0,
  targets_queued integer NOT NULL DEFAULT 0,
  targets_coalesced integer NOT NULL DEFAULT 0,
  targets_outboxed integer NOT NULL DEFAULT 0,
  targets_dispatched integer NOT NULL DEFAULT 0,
  targets_failed integer NOT NULL DEFAULT 0,
  targets_canceled integer NOT NULL DEFAULT 0,
  enumeration_cursor text NULL,
  fanout_cursor text NULL,
  pause_requested_at timestamptz NULL,
  resume_requested_at timestamptz NULL,
  cancel_requested_at timestamptz NULL,
  started_at timestamptz NULL,
  enumeration_completed_at timestamptz NULL,
  fanout_completed_at timestamptz NULL,
  completed_at timestamptz NULL,
  failed_at timestamptz NULL,
  last_error jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_bulk_jobs_operation_check CHECK (operation IN ('recommendation_recompute')),
  CONSTRAINT admin_bulk_jobs_scope_type_check CHECK (scope_type IN ('explicit_targets', 'all_users', 'tier')),
  CONSTRAINT admin_bulk_jobs_tier_check CHECK (tier IS NULL OR tier IN ('free', 'pro', 'ultra')),
  CONSTRAINT admin_bulk_jobs_tier_scope_check CHECK ((scope_type = 'tier' AND tier IS NOT NULL) OR (scope_type <> 'tier' AND tier IS NULL)),
  CONSTRAINT admin_bulk_jobs_status_check CHECK (status IN ('queued', 'enumerating', 'fanout', 'paused', 'canceling', 'canceled', 'completed', 'failed')),
  CONSTRAINT admin_bulk_jobs_counters_nonnegative CHECK (
    targets_total >= 0 AND targets_queued >= 0 AND targets_coalesced >= 0 AND targets_outboxed >= 0 AND
    targets_dispatched >= 0 AND targets_failed >= 0 AND targets_canceled >= 0
  )
);

CREATE TABLE IF NOT EXISTS admin_bulk_job_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bulk_job_id uuid NOT NULL REFERENCES admin_bulk_jobs(id) ON DELETE CASCADE,
  account_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  target_key text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  idempotency_key text NOT NULL,
  service_outbox_id text NULL REFERENCES service_outbox_events(id) ON DELETE SET NULL,
  coalesced_with_outbox_id text NULL REFERENCES service_outbox_events(id) ON DELETE SET NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  last_error jsonb NULL,
  locked_at timestamptz NULL,
  locked_by text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  outboxed_at timestamptz NULL,
  terminal_at timestamptz NULL,
  CONSTRAINT admin_bulk_job_targets_status_check CHECK (status IN ('queued', 'coalesced', 'outboxed', 'dispatched', 'failed', 'canceled')),
  CONSTRAINT admin_bulk_job_targets_attempt_count_nonnegative CHECK (attempt_count >= 0),
  CONSTRAINT admin_bulk_job_targets_target_key_nonempty CHECK (length(btrim(target_key)) > 0),
  CONSTRAINT admin_bulk_job_targets_idempotency_key_nonempty CHECK (length(btrim(idempotency_key)) > 0),
  UNIQUE (bulk_job_id, target_key)
);

CREATE TABLE IF NOT EXISTS admin_bulk_job_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bulk_job_id uuid NOT NULL REFERENCES admin_bulk_jobs(id) ON DELETE CASCADE,
  idempotency_key text NULL,
  dedupe_key text NOT NULL,
  request_hash text NOT NULL,
  request_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_by_admin_id text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_bulk_job_requests_request_snapshot_object CHECK (jsonb_typeof(request_snapshot) = 'object')
);

CREATE TABLE IF NOT EXISTS admin_bulk_job_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bulk_job_id uuid NOT NULL REFERENCES admin_bulk_jobs(id) ON DELETE CASCADE,
  bulk_job_target_id uuid NULL REFERENCES admin_bulk_job_targets(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  message text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_bulk_job_events_event_type_check CHECK (event_type IN (
    'created', 'previewed', 'coalesced', 'enumeration_started', 'target_enumerated', 'enumeration_completed',
    'fanout_started', 'target_outboxed', 'target_coalesced', 'fanout_completed', 'paused', 'resumed',
    'cancel_requested', 'canceled', 'failed', 'completed'
  )),
  CONSTRAINT admin_bulk_job_events_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);

ALTER TABLE service_outbox_events
  ADD COLUMN IF NOT EXISTS bulk_job_id uuid NULL REFERENCES admin_bulk_jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bulk_job_target_id uuid NULL REFERENCES admin_bulk_job_targets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS idempotency_key text NULL;

CREATE INDEX IF NOT EXISTS idx_admin_bulk_jobs_status ON admin_bulk_jobs (status);
CREATE INDEX IF NOT EXISTS idx_admin_bulk_jobs_operation ON admin_bulk_jobs (operation);
CREATE INDEX IF NOT EXISTS idx_admin_bulk_jobs_scope_type ON admin_bulk_jobs (scope_type);
CREATE INDEX IF NOT EXISTS idx_admin_bulk_jobs_tier ON admin_bulk_jobs (tier) WHERE tier IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_admin_bulk_jobs_created_at ON admin_bulk_jobs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_bulk_jobs_dedupe_active ON admin_bulk_jobs (dedupe_key, created_at DESC) WHERE status IN ('queued', 'enumerating', 'fanout', 'paused');
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_bulk_job_requests_idempotency_key ON admin_bulk_job_requests (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_admin_bulk_job_requests_dedupe_key ON admin_bulk_job_requests (dedupe_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_bulk_job_targets_job_status ON admin_bulk_job_targets (bulk_job_id, status);
CREATE INDEX IF NOT EXISTS idx_admin_bulk_job_targets_idempotency_key ON admin_bulk_job_targets (idempotency_key);
CREATE INDEX IF NOT EXISTS idx_admin_bulk_job_events_job_created ON admin_bulk_job_events (bulk_job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_outbox_events_bulk_job_id ON service_outbox_events (bulk_job_id) WHERE bulk_job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_service_outbox_events_bulk_job_target_id ON service_outbox_events (bulk_job_target_id) WHERE bulk_job_target_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_service_outbox_events_idempotency_key ON service_outbox_events (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_service_outbox_events_correlation_id ON service_outbox_events (correlation_id) WHERE correlation_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_service_outbox_events_active_idempotency_key ON service_outbox_events (idempotency_key) WHERE idempotency_key IS NOT NULL AND status IN ('pending', 'processing');
