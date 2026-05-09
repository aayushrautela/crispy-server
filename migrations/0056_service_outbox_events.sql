CREATE TABLE IF NOT EXISTS service_outbox_events (
  id text PRIMARY KEY,
  event_type text NOT NULL,
  event_version integer NOT NULL DEFAULT 1,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  user_id uuid NULL,
  profile_id uuid NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz NULL,
  next_attempt_at timestamptz NULL,
  locked_until timestamptz NULL,
  destination text NOT NULL,
  correlation_id text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_outbox_events_event_type_nonempty CHECK (length(btrim(event_type)) > 0),
  CONSTRAINT service_outbox_events_event_version_positive CHECK (event_version > 0),
  CONSTRAINT service_outbox_events_aggregate_type_nonempty CHECK (length(btrim(aggregate_type)) > 0),
  CONSTRAINT service_outbox_events_aggregate_id_nonempty CHECK (length(btrim(aggregate_id)) > 0),
  CONSTRAINT service_outbox_events_payload_object CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT service_outbox_events_status_valid CHECK (status IN ('pending', 'processing', 'dispatched', 'failed')), 
  CONSTRAINT service_outbox_events_attempt_count_nonnegative CHECK (attempt_count >= 0),
  CONSTRAINT service_outbox_events_destination_nonempty CHECK (length(btrim(destination)) > 0),
  CONSTRAINT service_outbox_events_processing_has_lock CHECK (status <> 'processing' OR locked_until IS NOT NULL),
  CONSTRAINT service_outbox_events_dispatched_not_locked CHECK (status <> 'dispatched' OR locked_until IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_service_outbox_events_pending_dispatch
  ON service_outbox_events (available_at ASC, occurred_at ASC, id ASC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_service_outbox_events_destination_status
  ON service_outbox_events (destination, status, available_at ASC);

CREATE INDEX IF NOT EXISTS idx_service_outbox_events_stale_processing
  ON service_outbox_events (locked_until ASC)
  WHERE status = 'processing';
