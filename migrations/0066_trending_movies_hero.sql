-- Render "Trending Movies" as a hero rail instead of a content rail.
-- The default-home builder caps heroCarousel at 10 items (DEFAULT_SECTION_LIMITS),
-- so no source_config change is required; the Trakt feed default limit is used
-- and the builder trims to the hero window.
--
-- The row still ranks first (rank=10), so the hero sits at the top of the home.

UPDATE home.default_list_templates
SET section_type = 'heroCarousel',
    updated_by = 'seed'
WHERE list_key = 'trakt-trending-movie'
  AND section_type <> 'heroCarousel';