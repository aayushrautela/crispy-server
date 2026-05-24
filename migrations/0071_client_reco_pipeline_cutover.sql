ALTER TABLE recommendation_list_versions
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS subtitle text,
  ADD COLUMN IF NOT EXISTS layout text;

UPDATE recommendation_list_versions
SET
  title = COALESCE(title, list_key),
  layout = COALESCE(layout, 'regular')
WHERE title IS NULL OR layout IS NULL;

ALTER TABLE recommendation_list_versions
  ALTER COLUMN title SET NOT NULL,
  ALTER COLUMN layout SET NOT NULL;

ALTER TABLE recommendation_list_versions
  DROP CONSTRAINT IF EXISTS recommendation_list_versions_layout_check;

ALTER TABLE recommendation_list_versions
  ADD CONSTRAINT recommendation_list_versions_layout_check
  CHECK (layout IN ('regular', 'landscape', 'hero', 'collection'));
