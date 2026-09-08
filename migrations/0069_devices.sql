CREATE TABLE private.devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES identity.accounts(id) ON DELETE CASCADE,
  client_id text NOT NULL,
  device_name text,
  device_type text NOT NULL DEFAULT 'tv' CHECK (device_type IN ('tv', 'mobile', 'web', 'desktop')),
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX devices_account_created_idx ON private.devices (account_id, created_at DESC);

ALTER TABLE private.personal_access_tokens
  ADD COLUMN device_id uuid REFERENCES private.devices(id) ON DELETE SET NULL;

-- claimed_device_id: device id the TV presented at authorize time (untrusted
-- echo, resolved against the approving account). device_id: actual device row
-- bound at approval; the minted token references it.
ALTER TABLE private.device_authorization_codes
  ADD COLUMN claimed_device_id text,
  ADD COLUMN device_id uuid REFERENCES private.devices(id) ON DELETE SET NULL;
