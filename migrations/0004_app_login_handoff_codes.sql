CREATE TABLE private.app_login_handoff_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES identity.accounts(id) ON DELETE CASCADE,
  code_hash text NOT NULL UNIQUE,
  code_preview text NOT NULL,
  return_uri text,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX app_login_handoff_codes_account_created_idx ON private.app_login_handoff_codes (account_id, created_at DESC);
CREATE INDEX app_login_handoff_codes_active_hash_idx ON private.app_login_handoff_codes (code_hash) WHERE consumed_at IS NULL;
CREATE INDEX app_login_handoff_codes_active_expiry_idx ON private.app_login_handoff_codes (expires_at) WHERE consumed_at IS NULL;
