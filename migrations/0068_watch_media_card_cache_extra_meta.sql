ALTER TABLE public.watch_media_card_cache
  ADD COLUMN IF NOT EXISTS overview text,
  ADD COLUMN IF NOT EXISTS runtime_minutes integer,
  ADD COLUMN IF NOT EXISTS release_date text,
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS episode_title text,
  ADD COLUMN IF NOT EXISTS episode_air_date text;

COMMENT ON COLUMN public.watch_media_card_cache.overview IS 'Short plot summary / tagline from TMDB.';
COMMENT ON COLUMN public.watch_media_card_cache.runtime_minutes IS 'Runtime in minutes: episode runtime for episodes, show/movie runtime otherwise.';
COMMENT ON COLUMN public.watch_media_card_cache.release_date IS 'Release or premiere date string (ISO-8601 date).';
COMMENT ON COLUMN public.watch_media_card_cache.status IS 'Release status (e.g. Released, In Production, Ended).';
COMMENT ON COLUMN public.watch_media_card_cache.episode_title IS 'Episode title for episode-level cache records.';
COMMENT ON COLUMN public.watch_media_card_cache.episode_air_date IS 'Episode air date for episode-level cache records.';
