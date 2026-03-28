ALTER TABLE watch_events
    ADD COLUMN provider text,
    ADD COLUMN provider_id text,
    ADD COLUMN parent_provider text,
    ADD COLUMN parent_provider_id text,
    ADD COLUMN absolute_episode_number integer,
    ADD CONSTRAINT watch_events_provider_check CHECK (provider IS NULL OR provider IN ('tmdb', 'tvdb', 'kitsu')),
    ADD CONSTRAINT watch_events_parent_provider_check CHECK (parent_provider IS NULL OR parent_provider IN ('tmdb', 'tvdb', 'kitsu'));

ALTER TABLE watch_history_entries
    ADD COLUMN provider text,
    ADD COLUMN provider_id text,
    ADD COLUMN parent_provider text,
    ADD COLUMN parent_provider_id text,
    ADD COLUMN absolute_episode_number integer,
    ADD CONSTRAINT watch_history_entries_provider_check CHECK (provider IS NULL OR provider IN ('tmdb', 'tvdb', 'kitsu')),
    ADD CONSTRAINT watch_history_entries_parent_provider_check CHECK (parent_provider IS NULL OR parent_provider IN ('tmdb', 'tvdb', 'kitsu'));

ALTER TABLE recommendation_event_outbox
    ADD COLUMN provider text,
    ADD COLUMN provider_id text,
    ADD COLUMN parent_provider text,
    ADD COLUMN parent_provider_id text,
    ADD COLUMN absolute_episode_number integer,
    ADD CONSTRAINT recommendation_event_outbox_provider_check CHECK (provider IS NULL OR provider IN ('tmdb', 'tvdb', 'kitsu')),
    ADD CONSTRAINT recommendation_event_outbox_parent_provider_check CHECK (parent_provider IS NULL OR parent_provider IN ('tmdb', 'tvdb', 'kitsu'));

UPDATE watch_events
SET provider = NULLIF(split_part(media_key, ':', 2), ''),
    provider_id = CASE
        WHEN media_type IN ('movie', 'show', 'anime') THEN NULLIF(split_part(media_key, ':', 3), '')
        WHEN media_type = 'season' THEN CONCAT(NULLIF(split_part(media_key, ':', 3), ''), ':s', COALESCE(season_number::text, NULLIF(split_part(media_key, ':', 4), '')))
        WHEN media_type = 'episode' AND episode_number IS NOT NULL THEN CONCAT(NULLIF(split_part(media_key, ':', 3), ''), ':s', season_number::text, ':e', episode_number::text)
        WHEN media_type = 'episode' AND NULLIF(split_part(media_key, ':', 4), '') IS NOT NULL THEN CONCAT(NULLIF(split_part(media_key, ':', 3), ''), ':a', NULLIF(split_part(media_key, ':', 4), ''))
        ELSE provider_id
    END,
    parent_provider = CASE WHEN media_type IN ('season', 'episode') THEN NULLIF(split_part(media_key, ':', 2), '') ELSE parent_provider END,
    parent_provider_id = CASE WHEN media_type IN ('season', 'episode') THEN NULLIF(split_part(media_key, ':', 3), '') ELSE parent_provider_id END,
    absolute_episode_number = CASE
        WHEN media_type = 'episode' AND episode_number IS NULL AND NULLIF(split_part(media_key, ':', 4), '') IS NOT NULL THEN split_part(media_key, ':', 4)::integer
        ELSE absolute_episode_number
    END
WHERE media_key IS NOT NULL AND media_key <> '';

UPDATE watch_history_entries
SET provider = NULLIF(split_part(media_key, ':', 2), ''),
    provider_id = CASE
        WHEN media_type IN ('movie', 'show', 'anime') THEN NULLIF(split_part(media_key, ':', 3), '')
        WHEN media_type = 'season' THEN CONCAT(NULLIF(split_part(media_key, ':', 3), ''), ':s', COALESCE(season_number::text, NULLIF(split_part(media_key, ':', 4), '')))
        WHEN media_type = 'episode' AND episode_number IS NOT NULL THEN CONCAT(NULLIF(split_part(media_key, ':', 3), ''), ':s', season_number::text, ':e', episode_number::text)
        WHEN media_type = 'episode' AND NULLIF(split_part(media_key, ':', 4), '') IS NOT NULL THEN CONCAT(NULLIF(split_part(media_key, ':', 3), ''), ':a', NULLIF(split_part(media_key, ':', 4), ''))
        ELSE provider_id
    END,
    parent_provider = CASE WHEN media_type IN ('season', 'episode') THEN NULLIF(split_part(media_key, ':', 2), '') ELSE parent_provider END,
    parent_provider_id = CASE WHEN media_type IN ('season', 'episode') THEN NULLIF(split_part(media_key, ':', 3), '') ELSE parent_provider_id END,
    absolute_episode_number = CASE
        WHEN media_type = 'episode' AND episode_number IS NULL AND NULLIF(split_part(media_key, ':', 4), '') IS NOT NULL THEN split_part(media_key, ':', 4)::integer
        ELSE absolute_episode_number
    END
WHERE media_key IS NOT NULL AND media_key <> '';

UPDATE recommendation_event_outbox
SET provider = NULLIF(split_part(media_key, ':', 2), ''),
    provider_id = CASE
        WHEN media_type IN ('movie', 'show', 'anime') THEN NULLIF(split_part(media_key, ':', 3), '')
        WHEN media_type = 'season' THEN CONCAT(NULLIF(split_part(media_key, ':', 3), ''), ':s', COALESCE(season_number::text, NULLIF(split_part(media_key, ':', 4), '')))
        WHEN media_type = 'episode' AND episode_number IS NOT NULL THEN CONCAT(NULLIF(split_part(media_key, ':', 3), ''), ':s', season_number::text, ':e', episode_number::text)
        WHEN media_type = 'episode' AND NULLIF(split_part(media_key, ':', 4), '') IS NOT NULL THEN CONCAT(NULLIF(split_part(media_key, ':', 3), ''), ':a', NULLIF(split_part(media_key, ':', 4), ''))
        ELSE provider_id
    END,
    parent_provider = CASE WHEN media_type IN ('season', 'episode') THEN NULLIF(split_part(media_key, ':', 2), '') ELSE parent_provider END,
    parent_provider_id = CASE WHEN media_type IN ('season', 'episode') THEN NULLIF(split_part(media_key, ':', 3), '') ELSE parent_provider_id END,
    absolute_episode_number = CASE
        WHEN media_type = 'episode' AND episode_number IS NULL AND NULLIF(split_part(media_key, ':', 4), '') IS NOT NULL THEN split_part(media_key, ':', 4)::integer
        ELSE absolute_episode_number
    END
WHERE media_key IS NOT NULL AND media_key <> '';
