-- Typed account addons: 'stremio' manifest bookmarks (all existing rows) and
-- 'jsplugin' stream-plugin records. The server remains a dumb bookmark store:
-- payload is opaque client-owned JSON.
ALTER TABLE identity.account_addons
  ADD COLUMN addon_type text NOT NULL DEFAULT 'stremio',
  ADD COLUMN payload jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE identity.account_addons
  ADD CONSTRAINT account_addons_type_check
  CHECK (addon_type IN ('stremio', 'jsplugin'));

-- Replace the URL-only unique index: plugin rows may share one repo manifest
-- URL (one row per enabled provider), so uniqueness becomes type-aware.
DROP INDEX IF EXISTS identity.idx_account_addons_manifest_url;

CREATE UNIQUE INDEX idx_account_addons_stremio_url
  ON identity.account_addons (account_id, manifest_url)
  WHERE addon_type = 'stremio';

CREATE UNIQUE INDEX idx_account_addons_plugin_provider
  ON identity.account_addons (account_id, manifest_url, (payload->>'providerId'))
  WHERE addon_type = 'jsplugin';
