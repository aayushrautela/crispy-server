-- Public account write API tables
CREATE TABLE IF NOT EXISTS public_account_recommendation_lists (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id uuid NOT NULL,
    profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    source text NOT NULL DEFAULT 'account_api',
    list_key text NOT NULL,
    schema_version text NOT NULL,
    media_type text NOT NULL,
    locale text,
    summary text,
    items_json jsonb NOT NULL,
    item_count integer NOT NULL,
    request_hash text NOT NULL,
    version integer NOT NULL DEFAULT 1,
    idempotency_key_hash text,
    created_by_type text NOT NULL,
    created_by_id text NOT NULL,
    updated_by_type text NOT NULL,
    updated_by_id text NOT NULL,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT public_account_reco_source_check CHECK (source = 'account_api'),
    CONSTRAINT public_account_reco_item_count_check CHECK (item_count >= 0 AND item_count <= 500),
    CONSTRAINT public_account_reco_items_array_check CHECK (jsonb_typeof(items_json) = 'array'),
    CONSTRAINT public_account_reco_list_key_check CHECK (list_key ~ '^external:[a-z0-9][a-z0-9._-]{0,63}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS public_account_reco_current_unique_idx
    ON public_account_recommendation_lists (profile_id, source, list_key)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS public_account_reco_account_profile_idx
    ON public_account_recommendation_lists (account_id, profile_id);

CREATE TABLE IF NOT EXISTS public_account_recommendation_list_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    list_id uuid NOT NULL REFERENCES public_account_recommendation_lists(id) ON DELETE CASCADE,
    version integer NOT NULL,
    schema_version text NOT NULL,
    media_type text NOT NULL,
    locale text,
    summary text,
    items_json jsonb NOT NULL,
    item_count integer NOT NULL,
    request_hash text NOT NULL,
    actor_type text NOT NULL,
    actor_id text NOT NULL,
    idempotency_key_hash text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT public_account_reco_version_items_array_check CHECK (jsonb_typeof(items_json) = 'array'),
    CONSTRAINT public_account_reco_version_unique UNIQUE (list_id, version)
);

CREATE TABLE IF NOT EXISTS public_account_taste_profiles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id uuid NOT NULL,
    profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    source text NOT NULL DEFAULT 'account_api',
    schema_version text NOT NULL,
    summary text,
    locale text,
    signals_json jsonb NOT NULL,
    signal_count integer NOT NULL,
    request_hash text NOT NULL,
    version integer NOT NULL DEFAULT 1,
    idempotency_key_hash text,
    created_by_type text NOT NULL,
    created_by_id text NOT NULL,
    updated_by_type text NOT NULL,
    updated_by_id text NOT NULL,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT public_account_taste_source_check CHECK (source = 'account_api'),
    CONSTRAINT public_account_taste_signal_count_check CHECK (signal_count >= 0 AND signal_count <= 250),
    CONSTRAINT public_account_taste_signals_array_check CHECK (jsonb_typeof(signals_json) = 'array')
);

CREATE UNIQUE INDEX IF NOT EXISTS public_account_taste_current_unique_idx
    ON public_account_taste_profiles (profile_id, source)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS public_account_taste_account_profile_idx
    ON public_account_taste_profiles (account_id, profile_id);

CREATE TABLE IF NOT EXISTS public_account_taste_profile_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    taste_profile_id uuid NOT NULL REFERENCES public_account_taste_profiles(id) ON DELETE CASCADE,
    version integer NOT NULL,
    schema_version text NOT NULL,
    summary text,
    locale text,
    signals_json jsonb NOT NULL,
    signal_count integer NOT NULL,
    request_hash text NOT NULL,
    actor_type text NOT NULL,
    actor_id text NOT NULL,
    idempotency_key_hash text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT public_account_taste_version_signals_array_check CHECK (jsonb_typeof(signals_json) = 'array'),
    CONSTRAINT public_account_taste_version_unique UNIQUE (taste_profile_id, version)
);

CREATE TABLE IF NOT EXISTS public_account_write_idempotency_keys (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id uuid NOT NULL,
    principal_type text NOT NULL,
    principal_id text NOT NULL,
    operation_key text NOT NULL,
    idempotency_key_hash text NOT NULL,
    request_hash text NOT NULL,
    response_status integer NOT NULL,
    response_json jsonb,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT public_account_idempotency_response_object_check CHECK (response_json IS NULL OR jsonb_typeof(response_json) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS public_account_write_idempotency_unique_idx
    ON public_account_write_idempotency_keys (account_id, principal_type, principal_id, operation_key, idempotency_key_hash);

CREATE INDEX IF NOT EXISTS public_account_write_idempotency_expiry_idx
    ON public_account_write_idempotency_keys (expires_at);

CREATE TABLE IF NOT EXISTS public_account_write_audit_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event text NOT NULL,
    account_id uuid,
    profile_id uuid,
    principal_type text,
    principal_id text,
    source text,
    list_key text,
    version integer,
    item_count integer,
    signal_count integer,
    request_hash text,
    idempotency_key_hash text,
    result text NOT NULL,
    ip inet,
    user_agent text,
    created_at timestamptz NOT NULL DEFAULT now()
);
