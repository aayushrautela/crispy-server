import type { DbClient } from '../../../../lib/db.js';

export type HistoryGenreHit = { genreId: number; mediaType: 'movie' | 'tv'; count: number };

/**
 * Deterministically aggregates the most-watched genres for a profile from its
 * watch history. Joins watch events -> tmdb provider refs -> tmdb_titles.genre_ids.
 * No ML: pure frequency count over the most recent `limit` history events.
 */
export async function topGenresForProfile(
  client: DbClient,
  profileId: string,
  limit: number,
  maxGenres: number,
): Promise<HistoryGenreHit[]> {
  const result = await client.query<{ genre_id: number; media_type: string; count: string }>(
    `WITH recent AS (
       SELECT we.title_item_id, we.media_type
       FROM user_state.watch_events we
       WHERE we.profile_id = $1::uuid
       ORDER BY we.occurred_at DESC
       LIMIT $2
     ), tmdb_refs AS (
       SELECT r.title_item_id, r.media_type, r.external_id::integer AS tmdb_id
       FROM recent r
       JOIN content_provider_refs tmdb_ref
         ON tmdb_ref.content_id = r.title_item_id
        AND tmdb_ref.provider = 'tmdb'
        AND tmdb_ref.entity_type = CASE WHEN r.media_type = 'movie' THEN 'movie' ELSE 'show' END
       LIMIT $2
     ), exploded AS (
       SELECT tr.media_type, (jsonb_array_elements(t.genre_ids)::text)::integer AS genre_id
       FROM tmdb_refs tr
       JOIN tmdb_titles t
         ON t.media_type = tr.media_type
        AND t.tmdb_id = tr.tmdb_id
        AND t.language = 'en-US'
     )
     SELECT genre_id, media_type, COUNT(*)::text AS count
     FROM exploded
     GROUP BY genre_id, media_type
     ORDER BY COUNT(*) DESC
     LIMIT $3`,
    [profileId, limit, maxGenres],
  );
  return result.rows.map((row) => ({
    genreId: Number(row.genre_id),
    mediaType: row.media_type === 'tv' ? 'tv' : 'movie',
    count: Number(row.count),
  }));
}

/** tmdb IDs (with media type) from the profile's recent watch history. */
export async function recentWatchedTmdbIds(
  client: DbClient,
  profileId: string,
  limit: number,
): Promise<Array<{ mediaType: 'movie' | 'tv'; tmdbId: number }>> {
  const result = await client.query<{ media_type: string; tmdb_id: number }>(
    `SELECT DISTINCT r.media_type, tr.external_id::integer AS tmdb_id
     FROM (
       SELECT we.title_item_id, we.media_type
       FROM user_state.watch_events we
       WHERE we.profile_id = $1::uuid
       ORDER BY we.occurred_at DESC
       LIMIT $2
     ) r
     JOIN content_provider_refs tr
       ON tr.content_id = r.title_item_id
      AND tr.provider = 'tmdb'
      AND tr.entity_type = CASE WHEN r.media_type = 'movie' THEN 'movie' ELSE 'show' END`,
    [profileId, limit],
  );
  return result.rows
    .filter((row) => Number.isInteger(row.tmdb_id))
    .map((row) => ({ mediaType: row.media_type === 'tv' ? 'tv' : 'movie', tmdbId: Number(row.tmdb_id) }));
}
