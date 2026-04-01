type TitleDedupedSourceTable = 'watch_history_latest' | 'watchlist_items' | 'ratings';
type TitleDedupedSortColumn = 'watched_at' | 'added_at' | 'rated_at';
type TitleDedupedExtraColumn = 'show_tmdb_id' | 'season_number' | 'episode_number';

export function buildTitleDedupedPageQuery(params: {
  tableName: TitleDedupedSourceTable;
  sortColumn: TitleDedupedSortColumn;
  extraColumns?: TitleDedupedExtraColumn[];
}): string {
  const extraColumns = params.extraColumns ?? [];
  const selectedColumns = [
    'source.media_key',
    'source.media_type',
    'source.tmdb_id',
    ...extraColumns.map((column) => `source.${column}`),
    `source.${params.sortColumn}`,
    'source.payload',
  ];
  const projectedColumns = [
    'media_key',
    'media_type',
    'tmdb_id',
    ...extraColumns,
    params.sortColumn,
    'payload',
  ];

  return `
        WITH ranked AS (
          SELECT ${selectedColumns.join(',\n                 ')},
                 row_number() OVER (
                   PARTITION BY cache.title_media_type, cache.title_provider, cache.title_provider_id
                   ORDER BY source.${params.sortColumn} DESC, source.media_key DESC
                 ) AS title_rank
          FROM ${params.tableName} source
          INNER JOIN watch_media_card_cache cache
            ON cache.media_key = source.media_key
          WHERE source.profile_id = $1::uuid
        )
        SELECT ${projectedColumns.join(', ')}
        FROM ranked
        WHERE title_rank = 1
          AND (
            $2::timestamptz IS NULL
            OR ${params.sortColumn} < $2::timestamptz
            OR (${params.sortColumn} = $2::timestamptz AND media_key < $3)
          )
        ORDER BY ${params.sortColumn} DESC, media_key DESC
        LIMIT $4
      `;
}
