-- Profile language profiles projection table
CREATE TABLE IF NOT EXISTS profile_language_profiles (
    profile_id uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    status text NOT NULL CHECK (status IN ('pending', 'ready', 'empty')),
    window_size integer NOT NULL DEFAULT 50,
    sample_size integer NOT NULL DEFAULT 0,
    ratios jsonb NOT NULL DEFAULT '[]'::jsonb,
    primary_language text,
    computed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profile_language_profiles_status
    ON profile_language_profiles(status, updated_at DESC);
