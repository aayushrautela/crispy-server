-- 0079_search_suggestions.sql
--
-- Curated keyword list behind GET /v1/search/suggestions. Typeahead used to
-- proxy TMDB /search per keystroke, which spent quota continuously and scaled
-- with active users. Suggestions are now rows here, refreshed from upstream
-- list endpoints and MDBList, and the route never calls TMDB.
--
-- A suggestion is a name, not an item. There is no public item id column
-- because a suggestion is not resolvable media: the client fills `name` into
-- the search box and /v1/search/titles resolves it. That keeps this table free
-- of the identity hydration every other media surface needs.
--
-- `normalized_name` is the match key (lowercased, diacritics and punctuation
-- stripped) so "Spider-Man" and "spider man" match the same prefix. `name` is
-- what the user sees.
--
-- Refreshes are replace-per-source: the refresh service deletes the rows for a
-- source then inserts the new set in one transaction, so a failed refresh
-- leaves the previous set intact.

CREATE TABLE private.search_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL CHECK (source IN ('trending', 'popular', 'classics')),
  name text NOT NULL,
  normalized_name text NOT NULL,
  rank integer NOT NULL CHECK (rank >= 0),
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, normalized_name)
);

-- Prefix match on the normalized key, strongest rank first within a source.
CREATE INDEX search_suggestions_prefix_idx
  ON private.search_suggestions (normalized_name text_pattern_ops, rank);

-- One row per source for cooldown and last-refreshed checks.
CREATE TABLE private.search_suggestion_refreshes (
  source text PRIMARY KEY CHECK (source IN ('trending', 'popular', 'classics')),
  entry_count integer NOT NULL DEFAULT 0,
  upstream_updated_at text,
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  refreshed_by text
);
