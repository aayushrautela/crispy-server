-- Final cutover for the single-layer TMDB overhaul.
-- Apply only after the application has been running on entity tables
-- (tmdb_titles + children) with no reads or writes against tmdb_api_responses.

DROP TABLE IF EXISTS tmdb_api_responses;
