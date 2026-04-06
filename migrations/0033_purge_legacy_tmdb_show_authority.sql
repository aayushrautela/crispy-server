WITH legacy_show_content AS (
    SELECT DISTINCT content_id
    FROM content_provider_refs
    WHERE provider = 'tmdb'
      AND entity_type = 'show'
),
legacy_season_content AS (
    SELECT DISTINCT content_id
    FROM content_provider_refs
    WHERE provider = 'tmdb'
      AND entity_type = 'season'
),
legacy_episode_content AS (
    SELECT DISTINCT content_id
    FROM content_provider_refs
    WHERE provider = 'tmdb'
      AND entity_type = 'episode'
),
all_legacy_content AS (
    SELECT content_id FROM legacy_show_content
    UNION
    SELECT content_id FROM legacy_season_content
    UNION
    SELECT content_id FROM legacy_episode_content
)
DELETE FROM profile_title_projection
WHERE title_content_id IN (SELECT content_id FROM all_legacy_content)
   OR active_content_id IN (SELECT content_id FROM all_legacy_content);

WITH legacy_show_content AS (
    SELECT DISTINCT content_id
    FROM content_provider_refs
    WHERE provider = 'tmdb'
      AND entity_type = 'show'
)
DELETE FROM profile_tracked_title_state
WHERE title_content_id IN (SELECT content_id FROM legacy_show_content);

WITH legacy_show_content AS (
    SELECT DISTINCT content_id
    FROM content_provider_refs
    WHERE provider = 'tmdb'
      AND entity_type = 'show'
),
legacy_season_content AS (
    SELECT DISTINCT content_id
    FROM content_provider_refs
    WHERE provider = 'tmdb'
      AND entity_type = 'season'
),
legacy_episode_content AS (
    SELECT DISTINCT content_id
    FROM content_provider_refs
    WHERE provider = 'tmdb'
      AND entity_type = 'episode'
),
all_legacy_content AS (
    SELECT content_id FROM legacy_show_content
    UNION
    SELECT content_id FROM legacy_season_content
    UNION
    SELECT content_id FROM legacy_episode_content
)
DELETE FROM profile_playable_state
WHERE content_id IN (SELECT content_id FROM all_legacy_content)
   OR title_content_id IN (SELECT content_id FROM all_legacy_content);

WITH legacy_show_content AS (
    SELECT DISTINCT content_id
    FROM content_provider_refs
    WHERE provider = 'tmdb'
      AND entity_type = 'show'
)
DELETE FROM profile_watch_override
WHERE target_content_id IN (SELECT content_id FROM legacy_show_content);

WITH legacy_show_content AS (
    SELECT DISTINCT content_id
    FROM content_provider_refs
    WHERE provider = 'tmdb'
      AND entity_type = 'show'
)
DELETE FROM profile_watchlist_state
WHERE target_content_id IN (SELECT content_id FROM legacy_show_content);

WITH legacy_show_content AS (
    SELECT DISTINCT content_id
    FROM content_provider_refs
    WHERE provider = 'tmdb'
      AND entity_type = 'show'
)
DELETE FROM profile_rating_state
WHERE target_content_id IN (SELECT content_id FROM legacy_show_content);

WITH legacy_show_content AS (
    SELECT DISTINCT content_id
    FROM content_provider_refs
    WHERE provider = 'tmdb'
      AND entity_type = 'show'
),
legacy_season_content AS (
    SELECT DISTINCT content_id
    FROM content_provider_refs
    WHERE provider = 'tmdb'
      AND entity_type = 'season'
),
legacy_episode_content AS (
    SELECT DISTINCT content_id
    FROM content_provider_refs
    WHERE provider = 'tmdb'
      AND entity_type = 'episode'
),
all_legacy_content AS (
    SELECT content_id FROM legacy_show_content
    UNION
    SELECT content_id FROM legacy_season_content
    UNION
    SELECT content_id FROM legacy_episode_content
)
DELETE FROM profile_play_history
WHERE content_id IN (SELECT content_id FROM all_legacy_content)
   OR title_content_id IN (SELECT content_id FROM all_legacy_content);

WITH legacy_show_content AS (
    SELECT DISTINCT content_id
    FROM content_provider_refs
    WHERE provider = 'tmdb'
      AND entity_type = 'show'
),
legacy_season_content AS (
    SELECT DISTINCT content_id
    FROM content_provider_refs
    WHERE provider = 'tmdb'
      AND entity_type = 'season'
),
legacy_episode_content AS (
    SELECT DISTINCT content_id
    FROM content_provider_refs
    WHERE provider = 'tmdb'
      AND entity_type = 'episode'
),
all_legacy_content AS (
    SELECT content_id FROM legacy_show_content
    UNION
    SELECT content_id FROM legacy_season_content
    UNION
    SELECT content_id FROM legacy_episode_content
)
DELETE FROM provider_outbox
WHERE content_id IN (SELECT content_id FROM all_legacy_content)
   OR title_content_id IN (SELECT content_id FROM all_legacy_content);

WITH legacy_show_content AS (
    SELECT DISTINCT content_id
    FROM content_provider_refs
    WHERE provider = 'tmdb'
      AND entity_type = 'show'
),
legacy_season_content AS (
    SELECT DISTINCT content_id
    FROM content_provider_refs
    WHERE provider = 'tmdb'
      AND entity_type = 'season'
),
legacy_episode_content AS (
    SELECT DISTINCT content_id
    FROM content_provider_refs
    WHERE provider = 'tmdb'
      AND entity_type = 'episode'
),
all_legacy_content AS (
    SELECT content_id FROM legacy_show_content
    UNION
    SELECT content_id FROM legacy_season_content
    UNION
    SELECT content_id FROM legacy_episode_content
)
DELETE FROM provider_history_shadow
WHERE content_id IN (SELECT content_id FROM all_legacy_content)
   OR title_content_id IN (SELECT content_id FROM all_legacy_content);

WITH legacy_show_content AS (
    SELECT DISTINCT content_id
    FROM content_provider_refs
    WHERE provider = 'tmdb'
      AND entity_type = 'show'
)
DELETE FROM provider_watchlist_shadow
WHERE title_content_id IN (SELECT content_id FROM legacy_show_content);

WITH legacy_show_content AS (
    SELECT DISTINCT content_id
    FROM content_provider_refs
    WHERE provider = 'tmdb'
      AND entity_type = 'show'
)
DELETE FROM provider_rating_shadow
WHERE title_content_id IN (SELECT content_id FROM legacy_show_content);

WITH legacy_show_content AS (
    SELECT DISTINCT content_id
    FROM content_provider_refs
    WHERE provider = 'tmdb'
      AND entity_type = 'show'
),
legacy_season_content AS (
    SELECT DISTINCT content_id
    FROM content_provider_refs
    WHERE provider = 'tmdb'
      AND entity_type = 'season'
),
legacy_episode_content AS (
    SELECT DISTINCT content_id
    FROM content_provider_refs
    WHERE provider = 'tmdb'
      AND entity_type = 'episode'
),
all_legacy_content AS (
    SELECT content_id FROM legacy_show_content
    UNION
    SELECT content_id FROM legacy_season_content
    UNION
    SELECT content_id FROM legacy_episode_content
)
DELETE FROM provider_progress_shadow
WHERE content_id IN (SELECT content_id FROM all_legacy_content)
   OR title_content_id IN (SELECT content_id FROM all_legacy_content);

WITH legacy_show_content AS (
    SELECT DISTINCT content_id
    FROM content_provider_refs
    WHERE provider = 'tmdb'
      AND entity_type = 'show'
),
legacy_season_content AS (
    SELECT DISTINCT content_id
    FROM content_provider_refs
    WHERE provider = 'tmdb'
      AND entity_type = 'season'
),
legacy_episode_content AS (
    SELECT DISTINCT content_id
    FROM content_provider_refs
    WHERE provider = 'tmdb'
      AND entity_type = 'episode'
),
all_legacy_content AS (
    SELECT content_id FROM legacy_show_content
    UNION
    SELECT content_id FROM legacy_season_content
    UNION
    SELECT content_id FROM legacy_episode_content
)
DELETE FROM provider_unresolved_objects
WHERE content_id IN (SELECT content_id FROM all_legacy_content)
   OR title_content_id IN (SELECT content_id FROM all_legacy_content);

DELETE FROM content_provider_refs
WHERE provider = 'tmdb'
  AND entity_type IN ('show', 'season', 'episode');

WITH legacy_orphans AS (
    SELECT ci.id
    FROM content_items ci
    WHERE ci.entity_type IN ('show', 'season', 'episode')
      AND NOT EXISTS (
          SELECT 1
          FROM content_provider_refs refs
          WHERE refs.content_id = ci.id
      )
)
DELETE FROM content_items ci
WHERE ci.id IN (SELECT id FROM legacy_orphans);

DELETE FROM watch_media_card_cache
WHERE media_key LIKE 'show:tmdb:%'
   OR media_key LIKE 'season:tmdb:%'
   OR media_key LIKE 'episode:tmdb:%';
