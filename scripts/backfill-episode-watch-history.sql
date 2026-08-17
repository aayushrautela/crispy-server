-- Backfill: correct Trakt/Simkl imported episode watch history that was
-- mislabeled as media_type='show' with NULL season/episode.
--
-- Root cause: the import history writer stored episode watch events using
-- canonicalTitleMediaType() (episode -> 'show') and the Trakt normalizer
-- omitted season/episode on the history entry. This UPDATE restores the
-- correct shape that native episode watch events already use.
--
-- Scope: profile 'e101595c-6d78-473d-a792-c8e46c381da6' (aayush@test18.com).
-- To apply globally, drop the profile_id filter.
--
-- Safety: only rows whose item_id resolves to an EPISODE content item
-- (content_provider_refs.entity_type = 'episode') are touched. Genuine
-- show-level rows (item_id = show content item) are left untouched because
-- they have no episode provider ref and therefore do not match the JOIN.

-- 1) Preview what will be updated (counts + a few samples).
SELECT
  count(*)                                            AS rows_to_fix,
  count(*) FILTER (WHERE we.media_type = 'show')       AS currently_show,
  count(*) FILTER (WHERE cpr.provider = 'tmdb')         AS via_tmdb_ref,
  count(*) FILTER (WHERE cpr.provider = 'tvdb')          AS via_tvdb_ref
FROM user_state.watch_events we
JOIN content_provider_refs cpr
  ON cpr.content_id = we.item_id
 AND cpr.entity_type = 'episode'
 AND cpr.external_id ~ ':s[0-9]+:e[0-9]+$'
WHERE we.profile_id = 'e101595c-6d78-473d-a792-c8e46c381da6'
  AND we.source_provider = 'trakt'
  AND we.source_kind = 'provider_import'
  AND we.media_type = 'show'
  AND we.season_number IS NULL
  AND we.episode_number IS NULL;

-- 2) Perform the backfill.
UPDATE user_state.watch_events we
SET media_type     = 'episode',
    season_number  = (regexp_match(cpr.external_id, ':s(\d+):e(\d+)$'))[1]::int,
    episode_number = (regexp_match(cpr.external_id, ':s(\d+):e(\d+)$'))[2]::int
FROM content_provider_refs cpr
WHERE we.profile_id = 'e101595c-6d78-473d-a792-c8e46c381da6'
  AND we.source_provider = 'trakt'
  AND we.source_kind = 'provider_import'
  AND we.media_type = 'show'
  AND we.season_number IS NULL
  AND we.episode_number IS NULL
  AND cpr.content_id = we.item_id
  AND cpr.entity_type = 'episode'
  AND cpr.external_id ~ ':s[0-9]+:e[0-9]+$';

-- 3) Verify: expect 0 remaining mislabeled rows for the profile.
SELECT
  count(*) FILTER (WHERE media_type = 'show' AND season_number IS NULL) AS still_mislabeled,
  count(*) FILTER (WHERE media_type = 'episode')                        AS episode_rows,
  count(*) FILTER (WHERE media_type = 'episode' AND season_number IS NOT NULL) AS episode_rows_with_season
FROM user_state.watch_events
WHERE profile_id = 'e101595c-6d78-473d-a792-c8e46c381da6';
