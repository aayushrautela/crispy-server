CREATE TABLE IF NOT EXISTS watch_media_card_cache (
    media_key text PRIMARY KEY,
    media_type text NOT NULL,
    title_provider text NOT NULL,
    title_provider_id text NOT NULL,
    title_media_type text NOT NULL CHECK (title_media_type IN ('movie', 'show', 'anime')),
    title text,
    subtitle text,
    poster_url text,
    backdrop_url text,
    release_year integer,
    rating numeric(5,2),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_watch_media_card_cache_provider
    ON watch_media_card_cache(title_provider, title_provider_id);

INSERT INTO watch_media_card_cache (
    media_key,
    media_type,
    title_provider,
    title_provider_id,
    title_media_type,
    title,
    subtitle,
    poster_url,
    backdrop_url,
    release_year,
    rating,
    updated_at
)
SELECT media_key,
       media_type,
       CASE
         WHEN media_type IN ('movie', 'show', 'anime') THEN split_part(media_key, ':', 2)
         ELSE coalesce(playback_parent_provider, split_part(media_key, ':', 2))
       END AS title_provider,
       CASE
         WHEN media_type IN ('movie', 'show', 'anime') THEN split_part(media_key, ':', 3)
         ELSE coalesce(playback_parent_provider_id, split_part(media_key, ':', 3))
       END AS title_provider_id,
       CASE
         WHEN details_title_media_type IN ('movie', 'show', 'anime') THEN details_title_media_type
         WHEN media_type = 'anime' THEN 'anime'
         WHEN media_type = 'movie' THEN 'movie'
         ELSE 'show'
       END AS title_media_type,
       title,
       subtitle,
       poster_url,
       backdrop_url,
       details_release_year,
       details_rating,
       now()
FROM (
    SELECT media_key,
           media_type,
           details_title_media_type,
           playback_parent_provider,
           playback_parent_provider_id,
           title,
           subtitle,
           poster_url,
           backdrop_url,
           details_release_year,
           details_rating,
           row_number() OVER (PARTITION BY media_key ORDER BY last_activity_at DESC NULLS LAST, watched_at DESC NULLS LAST, added_at DESC NULLS LAST, rated_at DESC NULLS LAST) AS row_rank
    FROM (
        SELECT media_key,
               media_type,
               details_title_media_type,
               playback_parent_provider,
               playback_parent_provider_id,
               title,
               subtitle,
               poster_url,
               backdrop_url,
               details_release_year,
               details_rating,
               last_activity_at,
               NULL::timestamptz AS watched_at,
               NULL::timestamptz AS added_at,
               NULL::timestamptz AS rated_at
        FROM continue_watching_projection
        UNION ALL
        SELECT media_key,
               media_type,
               details_title_media_type,
               playback_parent_provider,
               playback_parent_provider_id,
               title,
               subtitle,
               poster_url,
               backdrop_url,
               details_release_year,
               details_rating,
               NULL::timestamptz,
               watched_at,
               NULL::timestamptz,
               NULL::timestamptz
        FROM watch_history_latest
        UNION ALL
        SELECT media_key,
               media_type,
               details_title_media_type,
               playback_parent_provider,
               playback_parent_provider_id,
               title,
               subtitle,
               poster_url,
               backdrop_url,
               details_release_year,
               details_rating,
               NULL::timestamptz,
               NULL::timestamptz,
               added_at,
               NULL::timestamptz
        FROM watchlist_items
        UNION ALL
        SELECT media_key,
               media_type,
               details_title_media_type,
               playback_parent_provider,
               playback_parent_provider_id,
               title,
               subtitle,
               poster_url,
               backdrop_url,
               details_release_year,
               details_rating,
               NULL::timestamptz,
               NULL::timestamptz,
               NULL::timestamptz,
               rated_at
        FROM ratings
    ) seeded_rows
) deduped_rows
WHERE row_rank = 1
  AND title IS NOT NULL
  AND poster_url IS NOT NULL
  AND title_provider <> ''
  AND title_provider_id <> ''
ON CONFLICT (media_key)
DO UPDATE SET
    media_type = EXCLUDED.media_type,
    title_provider = EXCLUDED.title_provider,
    title_provider_id = EXCLUDED.title_provider_id,
    title_media_type = EXCLUDED.title_media_type,
    title = EXCLUDED.title,
    subtitle = EXCLUDED.subtitle,
    poster_url = EXCLUDED.poster_url,
    backdrop_url = EXCLUDED.backdrop_url,
    release_year = EXCLUDED.release_year,
    rating = EXCLUDED.rating,
    updated_at = now();
