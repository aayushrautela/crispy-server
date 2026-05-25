ALTER TABLE recommendation_list_versions
  ADD COLUMN IF NOT EXISTS section_type text;

UPDATE recommendation_list_versions
SET section_type = CASE COALESCE(section_type, layout)
  WHEN 'hero' THEN 'heroCarousel'
  WHEN 'collection' THEN 'collectionRail'
  WHEN 'regular' THEN 'contentRail'
  WHEN 'landscape' THEN 'contentRail'
  WHEN 'categoryTabs' THEN 'categoryTabs'
  WHEN 'heroCarousel' THEN 'heroCarousel'
  WHEN 'contentRail' THEN 'contentRail'
  WHEN 'collectionRail' THEN 'collectionRail'
  ELSE 'contentRail'
END;

ALTER TABLE recommendation_list_versions
  ALTER COLUMN section_type SET NOT NULL;

ALTER TABLE recommendation_list_versions
  DROP CONSTRAINT IF EXISTS recommendation_list_versions_layout_check,
  DROP CONSTRAINT IF EXISTS recommendation_list_versions_section_type_check;

ALTER TABLE recommendation_list_versions
  ADD CONSTRAINT recommendation_list_versions_section_type_check
  CHECK (section_type IN ('categoryTabs', 'heroCarousel', 'contentRail', 'collectionRail'));

ALTER TABLE recommendation_list_versions
  DROP COLUMN IF EXISTS layout;
