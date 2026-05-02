CREATE TABLE IF NOT EXISTS profile_input_signal_cache_sections (
  account_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  signal_family text NOT NULL,
  schema_version integer NOT NULL,
  payload_json jsonb NOT NULL,
  item_count integer NOT NULL,
  limit_coverage integer NOT NULL,
  since_coverage_start timestamptz NULL,
  since_coverage_end timestamptz NULL,
  materialized_at timestamptz NOT NULL DEFAULT NOW(),
  expires_at timestamptz NULL,
  source_version bigint NULL,
  source_latest_updated_at timestamptz NULL,
  is_complete boolean NOT NULL DEFAULT false,
  empty_kind text NOT NULL DEFAULT 'unknown',
  generation_reason text NOT NULL,
  invalidated_at timestamptz NULL,
  invalidation_reason text NULL,
  refresh_started_at timestamptz NULL,
  refresh_completed_at timestamptz NULL,
  refresh_error text NULL,
  CONSTRAINT profile_input_signal_cache_sections_family_chk CHECK (
    signal_family IN ('history', 'ratings', 'watchlist', 'continueWatching', 'trackedSeries')
  ),
  CONSTRAINT profile_input_signal_cache_sections_empty_kind_chk CHECK (
    empty_kind IN ('known_empty', 'not_empty', 'unknown')
  ),
  CONSTRAINT profile_input_signal_cache_sections_generation_reason_chk CHECK (
    generation_reason IN ('read_through', 'background_refresh', 'manual_backfill', 'repair', 'test_fixture')
  ),
  CONSTRAINT profile_input_signal_cache_sections_item_count_chk CHECK (item_count >= 0),
  CONSTRAINT profile_input_signal_cache_sections_limit_coverage_chk CHECK (limit_coverage >= 0),
  PRIMARY KEY (account_id, profile_id, signal_family, schema_version)
);

CREATE INDEX IF NOT EXISTS profile_input_signal_cache_sections_profile_idx
  ON profile_input_signal_cache_sections (account_id, profile_id);

CREATE INDEX IF NOT EXISTS profile_input_signal_cache_sections_refresh_idx
  ON profile_input_signal_cache_sections (signal_family, expires_at);

CREATE INDEX IF NOT EXISTS profile_input_signal_cache_sections_invalidated_idx
  ON profile_input_signal_cache_sections (invalidated_at)
  WHERE invalidated_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS profile_input_signal_cache_sections_refresh_started_idx
  ON profile_input_signal_cache_sections (refresh_started_at)
  WHERE refresh_started_at IS NOT NULL;
