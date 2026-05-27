CREATE TABLE private.external_api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES identity.accounts(id) ON DELETE CASCADE,
  name         text NOT NULL,
  key_hash     text NOT NULL,
  key_preview  text NOT NULL,
  scopes       text[] NOT NULL DEFAULT '{}',
  expires_at   timestamptz,
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_ext_api_keys_hash ON private.external_api_keys (key_hash) WHERE revoked_at IS NULL;
