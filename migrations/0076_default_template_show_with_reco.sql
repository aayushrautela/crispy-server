-- Per-rail opt-in for blending with reco.
--
-- The shared default home is served whole to profiles with no reco home. A rail
-- marked show_with_reco is ALSO layered underneath a profile's reco rails so a
-- personalized user keeps the evergreen generic sections (hero, pills, etc.).
-- Unmarked rails are default-only.
--
-- Everything starts unmarked; the admin UI toggles the flag per rail.

ALTER TABLE home.default_list_templates
  ADD COLUMN show_with_reco boolean NOT NULL DEFAULT false;