DELETE FROM watch_media_card_cache
WHERE media_key = 'movie:tmdb:328443';

DELETE FROM tmdb_external_ids
WHERE media_type = 'movie'
  AND tmdb_id = 328443;

DELETE FROM tmdb_titles
WHERE media_type = 'movie'
  AND tmdb_id = 328443;
