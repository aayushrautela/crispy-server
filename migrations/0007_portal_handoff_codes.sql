CREATE TABLE private.portal_handoff_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES identity.accounts(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  code_preview text NOT NULL,
  redirect_path text NOT NULL DEFAULT '/account',
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX portal_handoff_codes_active_hash_idx ON private.portal_handoff_codes (code_hash) WHERE consumed_at IS NULL;
CREATE INDEX portal_handoff_codes_account_created_idx ON private.portal_handoff_codes (account_id, created_at DESC);
