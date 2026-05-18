CREATE TABLE IF NOT EXISTS public.recommendation_snapshots (
  profile_id uuid NOT NULL REFERENCES identity.profiles(id) ON DELETE CASCADE,
  source_key text NOT NULL,
  history_generation integer NOT NULL,
  algorithm_version text NOT NULL,
  source_cursor text,
  generated_at timestamptz NOT NULL,
  expires_at timestamptz,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  source text NOT NULL,
  updated_by_kind text NOT NULL,
  updated_by_id text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, source_key, algorithm_version)
);

CREATE INDEX IF NOT EXISTS idx_recommendation_snapshots_profile
  ON public.recommendation_snapshots (profile_id, generated_at DESC);

COMMENT ON TABLE public.recommendation_snapshots IS 'Cached recommendation results per profile, source, and algorithm version.';
COMMENT ON COLUMN public.recommendation_snapshots.profile_id IS 'Owner profile.';
COMMENT ON COLUMN public.recommendation_snapshots.source_key IS 'Source identifier (e.g. taste_profile, watch_history).';
COMMENT ON COLUMN public.recommendation_snapshots.history_generation IS 'Watch history generation counter at time of generation.';
COMMENT ON COLUMN public.recommendation_snapshots.algorithm_version IS 'Recommendation algorithm version identifier.';
COMMENT ON COLUMN public.recommendation_snapshots.source_cursor IS 'Cursor for paginated source data during generation.';
COMMENT ON COLUMN public.recommendation_snapshots.generated_at IS 'When this snapshot was generated.';
COMMENT ON COLUMN public.recommendation_snapshots.expires_at IS 'When this snapshot expires (null = never).';
COMMENT ON COLUMN public.recommendation_snapshots.items IS 'Recommended items as JSONB array.';
COMMENT ON COLUMN public.recommendation_snapshots.source IS 'Generation source (e.g. collaborative, content_based).';
COMMENT ON COLUMN public.recommendation_snapshots.updated_by_kind IS 'Kind of entity that last updated this snapshot.';
COMMENT ON COLUMN public.recommendation_snapshots.updated_by_id IS 'ID of entity that last updated this snapshot.';
COMMENT ON COLUMN public.recommendation_snapshots.updated_at IS 'When this row was last updated.';
