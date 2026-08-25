-- One-time backfill: decompose every cached TMDB title payload stored in
-- tmdb_api_responses into the single-layer tables. Runs before the response
-- cache table is dropped (0057), so no previously fetched data is lost.

-- Core rows for titles known only through the response cache (guarantees every
-- backfilled child row has a parent).
INSERT INTO tmdb_titles (
  media_type, tmdb_id, original_name, original_language, release_date, first_air_date,
  poster_path, backdrop_path, status, runtime, episode_run_time, number_of_seasons,
  number_of_episodes, external_ids, genre_ids, vote_average, vote_count, popularity,
  adult, raw, hydration_level, fetched_at, expires_at
)
SELECT
  split_part(r.resource_id, ':', 1),
  split_part(r.resource_id, ':', 2)::integer,
  coalesce(nullif(r.response_json ->> 'original_title', ''), nullif(r.response_json ->> 'original_name', '')),
  coalesce(nullif(trim(r.response_json ->> 'original_language'), ''), 'en'),
  NULLIF(r.response_json ->> 'release_date', '')::date,
  NULLIF(r.response_json ->> 'first_air_date', '')::date,
  r.response_json ->> 'poster_path',
  r.response_json ->> 'backdrop_path',
  NULLIF(r.response_json ->> 'status', ''),
  NULLIF(r.response_json ->> 'runtime', '')::integer,
  COALESCE((SELECT jsonb_agg(to_jsonb(value)) FROM jsonb_array_elements(r.response_json -> 'episode_run_time') AS v(value)), '[]'::jsonb),
  NULLIF(r.response_json ->> 'number_of_seasons', '')::integer,
  NULLIF(r.response_json ->> 'number_of_episodes', '')::integer,
  COALESCE(r.response_json -> 'external_ids', '{}'::jsonb),
  COALESCE((SELECT jsonb_agg(to_jsonb(value)) FROM jsonb_array_elements(r.response_json -> 'genre_ids') AS g(value)), '[]'::jsonb),
  NULLIF(r.response_json ->> 'vote_average', '')::numeric,
  NULLIF(r.response_json ->> 'vote_count', '')::integer,
  NULLIF(r.response_json ->> 'popularity', '')::numeric,
  COALESCE(r.response_json ->> 'adult', 'false')::boolean,
  r.response_json,
  'detail',
  r.fetched_at,
  r.stale_until
FROM tmdb_api_responses r
WHERE r.resource_type = 'title' AND NOT r.is_negative
ON CONFLICT (media_type, tmdb_id) DO NOTHING;

-- Translations from the payload's own language.
INSERT INTO tmdb_title_translations (media_type, tmdb_id, lang, name, overview, tagline)
SELECT media_type, tmdb_id, lang, max(name) AS name, max(overview) AS overview, max(tagline) AS tagline
FROM (
  SELECT
    split_part(r.resource_id, ':', 1) AS media_type,
    split_part(r.resource_id, ':', 2)::integer AS tmdb_id,
    split_part(coalesce(nullif(trim(coalesce(r.language, '')), ''), 'en'), '-', 1) AS lang,
    coalesce(r.response_json ->> 'title', r.response_json ->> 'name') AS name,
    NULLIF(r.response_json ->> 'overview', '') AS overview,
    NULLIF(r.response_json ->> 'tagline', '') AS tagline
  FROM tmdb_api_responses r
  WHERE r.resource_type = 'title'
    AND NOT r.is_negative
    AND coalesce(r.response_json ->> 'title', r.response_json ->> 'name') IS NOT NULL
) s
GROUP BY media_type, tmdb_id, lang
ON CONFLICT (media_type, tmdb_id, lang) DO NOTHING;

-- Translations from the appended translations list.
INSERT INTO tmdb_title_translations (media_type, tmdb_id, lang, name, overview, tagline)
SELECT media_type, tmdb_id, lang, max(name) AS name, max(overview) AS overview, max(tagline) AS tagline
FROM (
  SELECT
    split_part(r.resource_id, ':', 1) AS media_type,
    split_part(r.resource_id, ':', 2)::integer AS tmdb_id,
    t.tr ->> 'iso_639_1' AS lang,
    t.tr #>> '{data,name}' AS name,
    t.tr #>> '{data,overview}' AS overview,
    t.tr #>> '{data,tagline}' AS tagline
  FROM tmdb_api_responses r
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(r.response_json #> ARRAY['translations', 'translations']) = 'array'
         THEN r.response_json #> ARRAY['translations', 'translations']
         ELSE '[]'::jsonb END
  ) AS t(tr)
  WHERE r.resource_type = 'title'
    AND NOT r.is_negative
    AND coalesce(t.tr ->> 'iso_639_1', '') <> ''
    AND coalesce(t.tr #>> '{data,name}', t.tr #>> '{data,overview}', t.tr #>> '{data,tagline}') IS NOT NULL
) s
GROUP BY media_type, tmdb_id, lang
ON CONFLICT (media_type, tmdb_id, lang) DO NOTHING;

-- Language-tagged images: posters, backdrops, logos.
INSERT INTO tmdb_images (media_type, tmdb_id, kind, file_path, iso_639_1, vote_average, vote_count, width, height)
SELECT
  split_part(r.resource_id, ':', 1),
  split_part(r.resource_id, ':', 2)::integer,
  'poster',
  i.entry ->> 'file_path',
  NULLIF(i.entry ->> 'iso_639_1', ''),
  NULLIF(i.entry ->> 'vote_average', '')::numeric,
  NULLIF(i.entry ->> 'vote_count', '')::integer,
  NULLIF(i.entry ->> 'width', '')::integer,
  NULLIF(i.entry ->> 'height', '')::integer
FROM tmdb_api_responses r
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(r.response_json #> ARRAY['images', 'posters']) = 'array'
       THEN r.response_json #> ARRAY['images', 'posters'] ELSE '[]'::jsonb END
) AS i(entry)
WHERE r.resource_type = 'title' AND NOT r.is_negative AND i.entry ->> 'file_path' IS NOT NULL
ON CONFLICT (media_type, tmdb_id, kind, file_path) DO UPDATE SET
  iso_639_1 = EXCLUDED.iso_639_1,
  vote_average = EXCLUDED.vote_average,
  vote_count = EXCLUDED.vote_count;

INSERT INTO tmdb_images (media_type, tmdb_id, kind, file_path, iso_639_1, vote_average, vote_count, width, height)
SELECT
  split_part(r.resource_id, ':', 1),
  split_part(r.resource_id, ':', 2)::integer,
  'backdrop',
  i.entry ->> 'file_path',
  NULLIF(i.entry ->> 'iso_639_1', ''),
  NULLIF(i.entry ->> 'vote_average', '')::numeric,
  NULLIF(i.entry ->> 'vote_count', '')::integer,
  NULLIF(i.entry ->> 'width', '')::integer,
  NULLIF(i.entry ->> 'height', '')::integer
FROM tmdb_api_responses r
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(r.response_json #> ARRAY['images', 'backdrops']) = 'array'
       THEN r.response_json #> ARRAY['images', 'backdrops'] ELSE '[]'::jsonb END
) AS i(entry)
WHERE r.resource_type = 'title' AND NOT r.is_negative AND i.entry ->> 'file_path' IS NOT NULL
ON CONFLICT (media_type, tmdb_id, kind, file_path) DO UPDATE SET
  iso_639_1 = EXCLUDED.iso_639_1,
  vote_average = EXCLUDED.vote_average,
  vote_count = EXCLUDED.vote_count;

INSERT INTO tmdb_images (media_type, tmdb_id, kind, file_path, iso_639_1, vote_average, vote_count, width, height)
SELECT
  split_part(r.resource_id, ':', 1),
  split_part(r.resource_id, ':', 2)::integer,
  'logo',
  i.entry ->> 'file_path',
  NULLIF(i.entry ->> 'iso_639_1', ''),
  NULLIF(i.entry ->> 'vote_average', '')::numeric,
  NULLIF(i.entry ->> 'vote_count', '')::integer,
  NULLIF(i.entry ->> 'width', '')::integer,
  NULLIF(i.entry ->> 'height', '')::integer
FROM tmdb_api_responses r
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(r.response_json #> ARRAY['images', 'logos']) = 'array'
       THEN r.response_json #> ARRAY['images', 'logos'] ELSE '[]'::jsonb END
) AS i(entry)
WHERE r.resource_type = 'title' AND NOT r.is_negative AND i.entry ->> 'file_path' IS NOT NULL
ON CONFLICT (media_type, tmdb_id, kind, file_path) DO UPDATE SET
  iso_639_1 = EXCLUDED.iso_639_1;

-- Written reviews.
INSERT INTO tmdb_reviews (media_type, tmdb_id, source, review_key, author, author_username, content, lang, url, rating, created_at, fetched_at)
SELECT
  split_part(r.resource_id, ':', 1),
  split_part(r.resource_id, ':', 2)::integer,
  'tmdb',
  v.rev ->> 'id',
  v.rev ->> 'author',
  v.rev #>> '{author_details,username}',
  v.rev ->> 'content',
  NULLIF(v.rev ->> 'iso_639_1', ''),
  v.rev ->> 'url',
  CASE WHEN v.rev #>> '{author_details,rating}' ~ '^[0-9.]+$' THEN v.rev #>> '{author_details,rating}' ELSE NULL END,
  NULLIF(v.rev ->> 'created_at', '')::timestamptz,
  r.fetched_at
FROM tmdb_api_responses r
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(r.response_json #> ARRAY['reviews', 'results']) = 'array'
       THEN r.response_json #> ARRAY['reviews', 'results'] ELSE '[]'::jsonb END
) AS v(rev)
WHERE r.resource_type = 'title'
  AND NOT r.is_negative
  AND coalesce(v.rev ->> 'content', '') <> ''
ON CONFLICT (media_type, tmdb_id, source, review_key) DO NOTHING;

-- Recommendation/similar edges + summary rows for targets not yet known.
WITH entries AS (
  SELECT
    split_part(r.resource_id, ':', 1) AS media_type,
    split_part(r.resource_id, ':', 2)::integer AS tmdb_id,
    k.kind,
    coalesce(nullif(e.entry ->> 'media_type', ''), split_part(r.resource_id, ':', 1)) AS target_media_type,
    (e.entry ->> 'id')::integer AS target_tmdb_id,
    e.ord,
    e.entry
  FROM tmdb_api_responses r
  CROSS JOIN LATERAL (VALUES ('recommendation', 'recommendations'), ('similar', 'similar')) AS k(kind, key)
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(r.response_json -> k.key -> 'results') = 'array'
         THEN r.response_json -> k.key -> 'results'
         ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS e(entry, ord)
  WHERE r.resource_type = 'title'
    AND NOT r.is_negative
    AND (e.entry ->> 'id') ~ '^[0-9]+$'
),
ins_rel AS (
  INSERT INTO tmdb_title_relations (source_media_type, source_tmdb_id, relation_kind, target_media_type, target_tmdb_id, rank)
  SELECT media_type, tmdb_id, kind, target_media_type, target_tmdb_id, min(ord)::integer
  FROM entries
  GROUP BY media_type, tmdb_id, kind, target_media_type, target_tmdb_id
  ON CONFLICT (source_media_type, source_tmdb_id, relation_kind, target_media_type, target_tmdb_id) DO NOTHING
  RETURNING 1
)
INSERT INTO tmdb_titles (
  media_type, tmdb_id, original_name, original_language, release_date, first_air_date,
  poster_path, backdrop_path, genre_ids, vote_average, vote_count, popularity, adult,
  raw, hydration_level
)
SELECT DISTINCT ON (target_media_type, target_tmdb_id)
  target_media_type,
  target_tmdb_id,
  coalesce(nullif(entry ->> 'original_title', ''), nullif(entry ->> 'original_name', '')),
  'en',
  NULLIF(entry ->> 'release_date', '')::date,
  NULLIF(entry ->> 'first_air_date', '')::date,
  entry ->> 'poster_path',
  entry ->> 'backdrop_path',
  COALESCE((SELECT jsonb_agg(to_jsonb(value)) FROM jsonb_array_elements(entry -> 'genre_ids') AS g(value)), '[]'::jsonb),
  NULLIF(entry ->> 'vote_average', '')::numeric,
  NULLIF(entry ->> 'vote_count', '')::integer,
  NULLIF(entry ->> 'popularity', '')::numeric,
  COALESCE(entry ->> 'adult', 'false')::boolean,
  entry,
  'summary'
FROM entries
WHERE NOT EXISTS (
  SELECT 1 FROM tmdb_titles t
  WHERE t.media_type = entries.target_media_type AND t.tmdb_id = entries.target_tmdb_id
)
ORDER BY target_media_type, target_tmdb_id;
