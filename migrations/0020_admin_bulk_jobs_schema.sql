-- Re-align admin_bulk_jobs (and siblings) with the repository.
--
-- The tables were originally created in 0001_base_identity.sql with a placeholder
-- shape (job_type / requested_by / request jsonb / counters jsonb / error jsonb).
-- The admin bulk job system was later fully implemented in
-- src/modules/admin-bulk-jobs/admin-bulk-job.repo.ts against a richer, relational
-- shape (scope_type / tier / dedupe_key / explicit counter + timestamp columns,
-- linkable from service_outbox_events via bulk_job_id) but no migration was ever
-- written to bring the schema in line. As a result every admin API call that
-- touched these tables 500'd with "column \"operation\" does not exist".
--
-- All four tables were empty (verified on production), so the safe fix is drop
-- and recreate. service_outbox_events already has the bulk_job_id /
-- bulk_job_target_id columns these tables link to.

DROP TABLE IF EXISTS admin_bulk_job_events;
DROP TABLE IF EXISTS admin_bulk_job_targets;
DROP TABLE IF EXISTS admin_bulk_job_requests;
DROP TABLE IF EXISTS admin_bulk_jobs;

CREATE TABLE admin_bulk_jobs (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation                   text NOT NULL,
  scope_type                  text NOT NULL,
  tier                        text,
  status                      text NOT NULL DEFAULT 'queued',
  requested_by_admin_id       text,
  request_correlation_id      text,
  dedupe_key                  text NOT NULL,
  idempotency_key             text,
  reason                      text,
  target_count_estimate       integer,
  targets_total               integer NOT NULL DEFAULT 0,
  targets_queued              integer NOT NULL DEFAULT 0,
  targets_coalesced           integer NOT NULL DEFAULT 0,
  targets_outboxed            integer NOT NULL DEFAULT 0,
  targets_dispatched          integer NOT NULL DEFAULT 0,
  targets_failed              integer NOT NULL DEFAULT 0,
  targets_canceled            integer NOT NULL DEFAULT 0,
  enumeration_cursor          text,
  fanout_cursor               text,
  pause_requested_at          timestamptz,
  resume_requested_at         timestamptz,
  cancel_requested_at         timestamptz,
  started_at                  timestamptz,
  enumeration_completed_at    timestamptz,
  fanout_completed_at         timestamptz,
  completed_at                timestamptz,
  failed_at                   timestamptz,
  last_error                  jsonb,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

-- findActiveByDedupeKey: WHERE dedupe_key = $1 AND status IN (...) ORDER BY created_at DESC
CREATE INDEX admin_bulk_jobs_dedupe_status_created_idx
  ON admin_bulk_jobs (dedupe_key, status, created_at DESC);

-- listJobs: ORDER BY created_at DESC with optional status / scope_type filters
CREATE INDEX admin_bulk_jobs_status_created_idx
  ON admin_bulk_jobs (status, created_at DESC);

-- claimNextJob: WHERE status IN (...) ORDER BY created_at ASC, id ASC FOR UPDATE SKIP LOCKED
CREATE INDEX admin_bulk_jobs_claim_idx
  ON admin_bulk_jobs (created_at ASC, id);

CREATE TABLE admin_bulk_job_targets (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bulk_job_id              uuid NOT NULL REFERENCES admin_bulk_jobs(id) ON DELETE CASCADE,
  account_id               uuid,
  profile_id               uuid,
  target_key               text NOT NULL,
  status                   text NOT NULL DEFAULT 'queued',
  idempotency_key          text NOT NULL,
  service_outbox_id        uuid,
  coalesced_with_outbox_id uuid,
  attempt_count            integer NOT NULL DEFAULT 0,
  last_error               jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  outboxed_at              timestamptz,
  terminal_at              timestamptz
);

-- insertTarget uses ON CONFLICT (bulk_job_id, target_key) DO NOTHING
CREATE UNIQUE INDEX admin_bulk_job_targets_job_target_key_uidx
  ON admin_bulk_job_targets (bulk_job_id, target_key);

-- listQueuedTargetsAfterCursor: WHERE bulk_job_id = $1 AND status = 'queued' AND target_key > $2
CREATE INDEX admin_bulk_job_targets_job_status_target_key_idx
  ON admin_bulk_job_targets (bulk_job_id, status, target_key);

CREATE INDEX admin_bulk_job_targets_profile_idx
  ON admin_bulk_job_targets (profile_id);

CREATE TABLE admin_bulk_job_requests (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bulk_job_id          uuid REFERENCES admin_bulk_jobs(id) ON DELETE SET NULL,
  idempotency_key      text,
  dedupe_key           text,
  request_hash         text NOT NULL,
  request_snapshot     jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_by_admin_id text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX admin_bulk_job_requests_idempotency_uidx
  ON admin_bulk_job_requests (idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE INDEX admin_bulk_job_requests_dedupe_idx
  ON admin_bulk_job_requests (dedupe_key, created_at DESC);

CREATE TABLE admin_bulk_job_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bulk_job_id         uuid NOT NULL REFERENCES admin_bulk_jobs(id) ON DELETE CASCADE,
  bulk_job_target_id  uuid,
  event_type          text NOT NULL,
  message             text,
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX admin_bulk_job_events_job_created_idx
  ON admin_bulk_job_events (bulk_job_id, created_at DESC);
