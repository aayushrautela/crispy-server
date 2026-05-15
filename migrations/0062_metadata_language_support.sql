-- Add language support to tmdb_titles and watch_media_card_cache

ALTER TABLE tmdb_titles DROP CONSTRAINT tmdb_titles_pkey;
ALTER TABLE tmdb_titles ADD COLUMN language text NOT NULL DEFAULT 'en';
ALTER TABLE tmdb_titles ADD PRIMARY KEY (media_type, tmdb_id, language);

ALTER TABLE watch_media_card_cache DROP CONSTRAINT watch_media_card_cache_pkey;
ALTER TABLE watch_media_card_cache ADD COLUMN language text NOT NULL DEFAULT 'en';
ALTER TABLE watch_media_card_cache ADD PRIMARY KEY (media_key, language);
