-- Per-section folder/cover image for home rails.
--
-- `imageUrl` is a client-supplied, opaque string (usually a CDN URL) carried
-- on the section itself so clients can render a folder/collection cover
-- without joining item artwork. It is never fetched server-side.
--
-- Applies to profile-owned lists (custom/reco) and to shared default-home
-- templates. Old rows predate the column and read back as NULL.

ALTER TABLE recommendation_list_versions
  ADD COLUMN IF NOT EXISTS image_url text;

ALTER TABLE home.default_list_templates
  ADD COLUMN IF NOT EXISTS image_url text;
