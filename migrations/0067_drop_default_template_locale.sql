-- The shared default home is a single English snapshot.
--
-- Locale-scoped rails made sense when the default home was resolved per
-- viewer; it is now one shared Redis snapshot, so 'locale' and 'locale_mode'
-- on home.default_list_templates are dead weight. The admin API and UI no
-- longer accept them. region_override stays: it is static per-rail config
-- used by region-scoped sources (e.g. trakt.popular-by-region).

DROP INDEX IF EXISTS home.home_default_tpl_mode_idx;

ALTER TABLE home.default_list_templates
  DROP COLUMN IF EXISTS locale_mode,
  DROP COLUMN IF EXISTS locale;
