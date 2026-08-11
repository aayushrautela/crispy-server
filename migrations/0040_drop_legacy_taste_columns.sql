-- Drop legacy flat taste columns from taste_profiles. The vectors column
-- (added in 0039) now carries the full dual-timeline weighted profile.
--
-- Legacy flat columns (genres, preferred_actors, preferred_directors,
-- decade_preferences, tags, mood) were lossy summaries only. All consumers
-- now read the vectors column directly.

ALTER TABLE taste_profiles
  DROP COLUMN genres,
  DROP COLUMN preferred_actors,
  DROP COLUMN preferred_directors,
  DROP COLUMN decade_preferences,
  DROP COLUMN tags,
  DROP COLUMN mood;
