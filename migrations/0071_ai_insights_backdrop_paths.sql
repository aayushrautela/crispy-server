-- Store the resolved TMDB backdrop file paths alongside the cached insight
-- payload so a cache hit can render slides without a live TMDB /images call.
-- Nullable so existing rows stay valid and self-heal on their next hit.
ALTER TABLE ai_insights_cache ADD COLUMN backdrop_paths text[];