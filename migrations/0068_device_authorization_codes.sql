CREATE TABLE private.device_authorization_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text NOT NULL,
  device_name text,
  device_code_hash text NOT NULL UNIQUE,
  device_code_preview text NOT NULL,
  user_code text NOT NULL,
  interval_seconds integer NOT NULL DEFAULT 5,
  last_polled_at timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'consumed')),
  account_id uuid REFERENCES identity.accounts(id) ON DELETE SET NULL,
  approved_at timestamptz,
  denied_at timestamptz,
  consumed_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX device_authorization_codes_pending_expiry_idx ON private.device_authorization_codes (expires_at) WHERE status = 'pending';
CREATE INDEX device_authorization_codes_account_created_idx ON private.device_authorization_codes (account_id, created_at DESC);

DROP TABLE IF EXISTS private.app_login_handoff_codes;
