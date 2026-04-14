CREATE TABLE IF NOT EXISTS provider_sessions (
    profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    provider text NOT NULL,
    state text NOT NULL CHECK (state IN ('not_connected', 'oauth_pending', 'connected', 'reauth_required', 'disconnected_by_user')),
    provider_account_id uuid REFERENCES provider_accounts(id) ON DELETE SET NULL,
    provider_user_id text,
    external_username text,
    credentials_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    state_token text,
    expires_at timestamptz,
    last_refresh_at timestamptz,
    last_refresh_error text,
    last_import_completed_at timestamptz,
    disconnected_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (profile_id, provider)
);

INSERT INTO provider_sessions (
    profile_id,
    provider,
    state,
    provider_account_id,
    provider_user_id,
    external_username,
    credentials_json,
    state_token,
    expires_at,
    last_refresh_at,
    last_refresh_error,
    last_import_completed_at,
    disconnected_at,
    created_at,
    updated_at
)
SELECT
    profiles.id AS profile_id,
    providers.provider,
    CASE
        WHEN selected.id IS NULL THEN 'not_connected'
        WHEN selected.status = 'pending' THEN 'oauth_pending'
        WHEN COALESCE(selected.credentials_json ->> 'disconnectedAt', '') <> '' THEN 'disconnected_by_user'
        WHEN selected.status = 'connected'
             AND COALESCE(selected.credentials_json ->> 'accessToken', '') <> ''
             AND (
                 NULLIF(selected.credentials_json ->> 'accessTokenExpiresAt', '') IS NULL
                 OR NULLIF(selected.credentials_json ->> 'accessTokenExpiresAt', '')::timestamptz > now()
             )
             AND COALESCE(selected.credentials_json ->> 'lastRefreshError', '') = ''
          THEN 'connected'
        WHEN selected.status = 'connected' OR selected.status = 'revoked' THEN 'reauth_required'
        ELSE 'not_connected'
    END AS state,
    selected.id AS provider_account_id,
    selected.provider_user_id,
    selected.external_username,
    CASE
        WHEN selected.id IS NULL THEN '{}'::jsonb
        WHEN selected.status = 'pending' THEN jsonb_strip_nulls(jsonb_build_object(
            'pkceCodeVerifier', NULLIF(selected.credentials_json ->> 'pkceCodeVerifier', ''),
            'pkceCodeChallenge', NULLIF(selected.credentials_json ->> 'pkceCodeChallenge', '')
        ))
        WHEN COALESCE(selected.credentials_json ->> 'disconnectedAt', '') <> '' THEN '{}'::jsonb
        WHEN selected.status = 'connected'
             AND COALESCE(selected.credentials_json ->> 'accessToken', '') <> ''
             AND (
                 NULLIF(selected.credentials_json ->> 'accessTokenExpiresAt', '') IS NULL
                 OR NULLIF(selected.credentials_json ->> 'accessTokenExpiresAt', '')::timestamptz > now()
             )
             AND COALESCE(selected.credentials_json ->> 'lastRefreshError', '') = ''
          THEN jsonb_strip_nulls(jsonb_build_object(
            'accessToken', NULLIF(selected.credentials_json ->> 'accessToken', ''),
            'refreshToken', NULLIF(selected.credentials_json ->> 'refreshToken', ''),
            'accessTokenExpiresAt', NULLIF(selected.credentials_json ->> 'accessTokenExpiresAt', ''),
            'connectedAt', NULLIF(selected.credentials_json ->> 'connectedAt', ''),
            'lastRefreshAt', NULLIF(selected.credentials_json ->> 'lastRefreshAt', ''),
            'lastImportJobId', NULLIF(selected.credentials_json ->> 'lastImportJobId', ''),
            'lastImportCompletedAt', NULLIF(selected.credentials_json ->> 'lastImportCompletedAt', '')
        ))
        ELSE jsonb_strip_nulls(jsonb_build_object(
            'connectedAt', NULLIF(selected.credentials_json ->> 'connectedAt', ''),
            'lastRefreshAt', NULLIF(selected.credentials_json ->> 'lastRefreshAt', ''),
            'lastRefreshError', NULLIF(selected.credentials_json ->> 'lastRefreshError', ''),
            'lastImportJobId', NULLIF(selected.credentials_json ->> 'lastImportJobId', ''),
            'lastImportCompletedAt', NULLIF(selected.credentials_json ->> 'lastImportCompletedAt', '')
        ))
    END AS credentials_json,
    selected.state_token,
    selected.expires_at,
    NULLIF(selected.credentials_json ->> 'lastRefreshAt', '')::timestamptz AS last_refresh_at,
    NULLIF(selected.credentials_json ->> 'lastRefreshError', '') AS last_refresh_error,
    NULLIF(selected.credentials_json ->> 'lastImportCompletedAt', '')::timestamptz AS last_import_completed_at,
    NULLIF(selected.credentials_json ->> 'disconnectedAt', '')::timestamptz AS disconnected_at,
    COALESCE(selected.created_at, now()) AS created_at,
    COALESCE(selected.updated_at, now()) AS updated_at
FROM profiles
CROSS JOIN (VALUES ('trakt'), ('simkl')) AS providers(provider)
LEFT JOIN LATERAL (
    SELECT pa.*
    FROM provider_accounts pa
    WHERE pa.profile_id = profiles.id
      AND pa.provider = providers.provider
    ORDER BY
        CASE pa.status
            WHEN 'connected' THEN 0
            WHEN 'pending' THEN 1
            WHEN 'revoked' THEN 2
            WHEN 'expired' THEN 3
            ELSE 4
        END,
        pa.updated_at DESC,
        pa.created_at DESC,
        pa.id DESC
    LIMIT 1
) AS selected ON true
ON CONFLICT (profile_id, provider) DO NOTHING;

UPDATE provider_accounts
SET credentials_json = jsonb_strip_nulls(jsonb_build_object(
        'connectedAt', NULLIF(credentials_json ->> 'connectedAt', ''),
        'lastRefreshAt', NULLIF(credentials_json ->> 'lastRefreshAt', ''),
        'lastRefreshError', NULLIF(credentials_json ->> 'lastRefreshError', ''),
        'lastImportJobId', NULLIF(credentials_json ->> 'lastImportJobId', ''),
        'lastImportCompletedAt', NULLIF(credentials_json ->> 'lastImportCompletedAt', ''),
        'disconnectedAt', NULLIF(credentials_json ->> 'disconnectedAt', ''),
        'disconnectedByUserId', NULLIF(credentials_json ->> 'disconnectedByUserId', ''),
        'revokedAt', NULLIF(credentials_json ->> 'revokedAt', '')
    ))
WHERE EXISTS (
    SELECT 1
    FROM provider_sessions ps
    WHERE ps.provider_account_id IS NOT NULL
      AND ps.provider_account_id <> provider_accounts.id
      AND ps.profile_id = provider_accounts.profile_id
      AND ps.provider = provider_accounts.provider
)
   OR status <> 'connected';

CREATE INDEX IF NOT EXISTS idx_provider_sessions_state
    ON provider_sessions(state, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_provider_sessions_provider_account
    ON provider_sessions(provider_account_id)
    WHERE provider_account_id IS NOT NULL;
