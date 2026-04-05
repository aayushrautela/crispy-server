WITH bad_content AS (
    SELECT content_id
    FROM content_provider_refs
    WHERE provider = 'tmdb'
      AND entity_type = 'movie'
      AND external_id = '328443'
),
deleted_refs AS (
    DELETE FROM content_provider_refs
    WHERE provider = 'tmdb'
      AND entity_type = 'movie'
      AND external_id = '328443'
    RETURNING content_id
)
DELETE FROM content_items ci
WHERE ci.id IN (
    SELECT content_id FROM bad_content
    UNION
    SELECT content_id FROM deleted_refs
)
AND NOT EXISTS (
    SELECT 1
    FROM content_provider_refs refs
    WHERE refs.content_id = ci.id
);
