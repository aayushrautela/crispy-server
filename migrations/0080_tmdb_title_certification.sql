-- 0080_tmdb_title_certification.sql
--
-- Maturity rating ("PG-13", "TV-MA") is a language-invariant fact about a
-- title, so it belongs in a real column beside the other detail-level facts.
-- Until now it was parsed out of tmdb_titles.raw at read time, which meant it
-- silently disappeared whenever the stored payload lacked the TMDB
-- sub-resource carrying it: certification lives in `release_dates` on movies
-- and `content_ratings` on tv, and neither is part of the base title response.
-- They only arrive when append_to_response asks for them, and the ingest
-- request did not, so every maturity rating read back as NULL.
--
-- Backfill recovers certification from the raw payloads already stored, which
-- still carry it for titles ingested before the sub-resources were dropped.
-- US is preferred, matching the behaviour the read-time parser had, falling
-- back to the first region TMDB returned a non-empty rating for.
--
-- Detail rows still without a certification get their expiry pulled into the
-- past so TmdbCacheService's stale-while-revalidate path re-ingests them once
-- and fills the column. This is demand-driven, not a batch re-fetch: a row is
-- only re-ingested when something reads it. Titles that genuinely have no
-- rating stay NULL.

ALTER TABLE tmdb_titles ADD COLUMN IF NOT EXISTS certification text;

-- Movies: release_dates.results[] -> per-country release_dates[].certification
UPDATE tmdb_titles t
SET certification = source.certification
FROM (
  SELECT DISTINCT ON (c.media_type, c.tmdb_id)
         c.media_type,
         c.tmdb_id,
         country_pick.certification
  FROM tmdb_titles c
  CROSS JOIN LATERAL jsonb_array_elements(
    COALESCE(c.raw -> 'release_dates' -> 'results', '[]'::jsonb)
  ) AS country(entry)
  CROSS JOIN LATERAL (
    SELECT NULLIF(btrim(rd.item ->> 'certification'), '') AS certification
    FROM jsonb_array_elements(COALESCE(country.entry -> 'release_dates', '[]'::jsonb))
      WITH ORDINALITY AS rd(item, ord)
    WHERE NULLIF(btrim(rd.item ->> 'certification'), '') IS NOT NULL
    ORDER BY rd.ord
    LIMIT 1
  ) country_pick
  WHERE c.media_type = 'movie'
    AND c.hydration_level = 'detail'
    AND country_pick.certification IS NOT NULL
  ORDER BY
    c.media_type,
    c.tmdb_id,
    (country.entry ->> 'iso_3166_1') = 'US' DESC NULLS LAST,
    country.entry ->> 'iso_3166_1',
    c.ctid
) source
WHERE t.media_type = source.media_type
  AND t.tmdb_id = source.tmdb_id
  AND t.certification IS NULL;

-- tv: content_ratings.results[] -> per-country rating
UPDATE tmdb_titles t
SET certification = source.certification
FROM (
  SELECT DISTINCT ON (c.media_type, c.tmdb_id)
         c.media_type,
         c.tmdb_id,
         NULLIF(btrim(region.entry ->> 'rating'), '') AS certification
  FROM tmdb_titles c
  CROSS JOIN LATERAL jsonb_array_elements(
    COALESCE(c.raw -> 'content_ratings' -> 'results', '[]'::jsonb)
  ) AS region(entry)
  WHERE c.media_type = 'tv'
    AND c.hydration_level = 'detail'
    AND NULLIF(btrim(region.entry ->> 'rating'), '') IS NOT NULL
  ORDER BY
    c.media_type,
    c.tmdb_id,
    (region.entry ->> 'iso_3166_1') = 'US' DESC NULLS LAST,
    region.entry ->> 'iso_3166_1',
    c.ctid
) source
WHERE t.media_type = source.media_type
  AND t.tmdb_id = source.tmdb_id
  AND t.certification IS NULL;

UPDATE tmdb_titles
SET expires_at = now() - interval '1 minute'
WHERE hydration_level = 'detail'
  AND certification IS NULL;
