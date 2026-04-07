DELETE FROM tmdb_titles
WHERE raw ? 'similar'
  AND NOT (raw ? 'recommendations');
