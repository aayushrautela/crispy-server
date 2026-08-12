-- Upgrade stored taste_profiles.vectors from schemaVersion 1 to 2.
--
-- v2 is now the only accepted shape: the server validates the taste vectors
-- against enum: [2] and requires the ratingTiers vector. This migration
-- promotes existing v1 payloads in place by setting schemaVersion = 2 and
-- ensuring ratingTiers is present (default empty). Not production yet, so we
-- simply upgrade rather than keep a v1 fallback path.

UPDATE taste_profiles
SET vectors = jsonb_set(
  jsonb_set(vectors, '{schemaVersion}', '2'::jsonb),
  '{ratingTiers}', COALESCE(vectors->'ratingTiers', '[]'::jsonb)
)
WHERE vectors ? 'schemaVersion'
  AND (vectors->>'schemaVersion')::int = 1;
