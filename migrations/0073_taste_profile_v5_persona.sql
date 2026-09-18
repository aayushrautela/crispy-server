ALTER TABLE taste_profiles
  ADD COLUMN IF NOT EXISTS persona_long_term text,
  ADD COLUMN IF NOT EXISTS persona_short_term text,
  ADD COLUMN IF NOT EXISTS persona_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS persona_watch_fingerprint text,
  ADD COLUMN IF NOT EXISTS avoidances jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE taste_profiles
  ADD CONSTRAINT taste_profiles_avoidances_array CHECK (jsonb_typeof(avoidances) = 'array');
