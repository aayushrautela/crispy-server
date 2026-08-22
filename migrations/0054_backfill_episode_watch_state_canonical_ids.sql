-- 0054_backfill_episode_watch_state_canonical_ids.sql
--
-- Episode content ids are provider-namespaced: a progress event or provider
-- import may have stored a watch_state row keyed on an addon-namespace episode
-- content id, while the metadata service serves episodes under the TMDB-authority
-- content id for (seriesTmdbId, season, episode). watch_state no longer stores
-- season/episode (see 0050); the read model derives them from the content graph
-- joined on item_id, so re-pointing item_id to the canonical episode makes
-- Continue Watching ids match the metadata service episode ids.
--
-- Set-based and idempotent: a second run finds no rows where the canonical id
-- differs from the stored id.

UPDATE user_state.watch_state AS ws
SET item_id = target.canonical_episode_id
FROM (
  SELECT DISTINCT
    ws_row.item_id AS from_id,
    tmdb_ep.content_id AS canonical_episode_id
  FROM user_state.watch_state ws_row
  JOIN content_items ep
    ON ep.id = ws_row.item_id
   AND ep.entity_type = 'episode'
  -- Series of the (possibly non-canonical) episode.
  JOIN content_item_relationships cir_src
    ON cir_src.child_content_id = ep.id
   AND cir_src.relationship_type = 'series'
  -- Season/episode of that episode from its provider-ref metadata.
  JOIN content_provider_refs ref_src
    ON ref_src.content_id = ep.id
   AND ref_src.entity_type = 'episode'
  -- Canonical TMDB episode for the same series + season + episode.
  JOIN content_provider_refs tmdb_ep
    ON tmdb_ep.provider = 'tmdb'
   AND tmdb_ep.entity_type = 'episode'
   AND tmdb_ep.metadata->>'seasonNumber' = ref_src.metadata->>'seasonNumber'
   AND tmdb_ep.metadata->>'episodeNumber' = ref_src.metadata->>'episodeNumber'
  JOIN content_item_relationships cir_tgt
    ON cir_tgt.child_content_id = tmdb_ep.content_id
   AND cir_tgt.relationship_type = 'series'
   AND cir_tgt.parent_content_id = cir_src.parent_content_id
  WHERE tmdb_ep.content_id <> ws_row.item_id
) AS target
WHERE ws.item_id = target.from_id;
