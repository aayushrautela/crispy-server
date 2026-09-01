-- Account addons (Stremio-style manifest URLs).
--
-- Server only stores the manifest URL per account. The client is responsible
-- for fetching/parsing the manifest and using the addon. Addons are
-- account-scoped and shared across all profiles; only the admin profile can
-- install or remove them.

CREATE TABLE identity.account_addons (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES identity.accounts(id) ON DELETE CASCADE,
  manifest_url  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_account_addons_manifest_url
  ON identity.account_addons (account_id, manifest_url);

CREATE INDEX idx_account_addons_account_id
  ON identity.account_addons (account_id);
