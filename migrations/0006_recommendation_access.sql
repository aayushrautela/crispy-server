CREATE TABLE IF NOT EXISTS taste_profiles (
    profile_id uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    genres jsonb NOT NULL DEFAULT '[]'::jsonb,
    preferred_actors jsonb NOT NULL DEFAULT '[]'::jsonb,
    preferred_directors jsonb NOT NULL DEFAULT '[]'::jsonb,
    content_type_pref jsonb NOT NULL DEFAULT '{}'::jsonb,
    rating_tendency jsonb NOT NULL DEFAULT '{}'::jsonb,
    decade_preferences jsonb NOT NULL DEFAULT '[]'::jsonb,
    watching_pace text,
    ai_summary text,
    source text NOT NULL DEFAULT 'unknown',
    updated_by_kind text NOT NULL DEFAULT 'service' CHECK (updated_by_kind IN ('service', 'user', 'pat', 'oauth_app')),
    updated_by_id text,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE recommendation_snapshots
    ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'unknown';

ALTER TABLE recommendation_snapshots
    ADD COLUMN IF NOT EXISTS updated_by_kind text NOT NULL DEFAULT 'service';

ALTER TABLE recommendation_snapshots
    ADD COLUMN IF NOT EXISTS updated_by_id text;

CREATE TABLE IF NOT EXISTS personal_access_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    name text NOT NULL,
    token_hash text NOT NULL UNIQUE,
    token_preview text NOT NULL,
    scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
    expires_at timestamptz,
    last_used_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_personal_access_tokens_user_created
    ON personal_access_tokens(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_personal_access_tokens_active
    ON personal_access_tokens(user_id, revoked_at, expires_at)
    WHERE revoked_at IS NULL;
