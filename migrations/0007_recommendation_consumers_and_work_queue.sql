CREATE TABLE IF NOT EXISTS recommendation_consumers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    consumer_key text NOT NULL UNIQUE,
    owner_kind text NOT NULL CHECK (owner_kind IN ('service', 'user', 'oauth_app')),
    owner_user_id uuid REFERENCES app_users(id) ON DELETE CASCADE,
    display_name text NOT NULL,
    source_key text NOT NULL UNIQUE,
    is_internal boolean NOT NULL DEFAULT false,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recommendation_profile_work_state (
    consumer_id uuid NOT NULL REFERENCES recommendation_consumers(id) ON DELETE CASCADE,
    profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    last_completed_event_id bigint NOT NULL DEFAULT 0,
    claimed_through_event_id bigint,
    claimed_history_generation integer,
    lease_id uuid,
    lease_owner text,
    lease_expires_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (consumer_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_recommendation_work_state_consumer_lease
    ON recommendation_profile_work_state(consumer_id, lease_expires_at);

CREATE INDEX IF NOT EXISTS idx_recommendation_work_state_consumer_completed
    ON recommendation_profile_work_state(consumer_id, last_completed_event_id);

CREATE INDEX IF NOT EXISTS idx_recommendation_work_state_profile_consumer
    ON recommendation_profile_work_state(profile_id, consumer_id);

ALTER TABLE taste_profiles
    ADD COLUMN IF NOT EXISTS source_key text;

UPDATE taste_profiles
SET source_key = COALESCE(NULLIF(source, ''), 'legacy-default')
WHERE source_key IS NULL;

ALTER TABLE taste_profiles
    ALTER COLUMN source_key SET NOT NULL;

ALTER TABLE taste_profiles
    DROP CONSTRAINT IF EXISTS taste_profiles_pkey;

ALTER TABLE taste_profiles
    ADD CONSTRAINT taste_profiles_pkey PRIMARY KEY (profile_id, source_key);

ALTER TABLE recommendation_snapshots
    ADD COLUMN IF NOT EXISTS source_key text;

UPDATE recommendation_snapshots
SET source_key = COALESCE(NULLIF(source, ''), 'legacy-default')
WHERE source_key IS NULL;

ALTER TABLE recommendation_snapshots
    ALTER COLUMN source_key SET NOT NULL;

ALTER TABLE recommendation_snapshots
    DROP CONSTRAINT IF EXISTS recommendation_snapshots_pkey;

ALTER TABLE recommendation_snapshots
    ADD CONSTRAINT recommendation_snapshots_pkey PRIMARY KEY (profile_id, source_key, algorithm_version);
