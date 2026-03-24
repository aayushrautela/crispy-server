CREATE TABLE IF NOT EXISTS account_settings (
    app_user_id uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
    settings_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS account_secrets (
    app_user_id uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
    secrets_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO account_secrets (app_user_id, secrets_json, updated_at)
SELECT source.app_user_id, jsonb_build_object('ai.openrouter_key', source.openrouter_key), now()
FROM (
    SELECT DISTINCT ON (h.owner_user_id)
        h.owner_user_id AS app_user_id,
        btrim(ps.settings_json ->> 'ai.openrouter_key') AS openrouter_key
    FROM profile_settings ps
    INNER JOIN profiles p ON p.id = ps.profile_id
    INNER JOIN households h ON h.id = p.household_id
    WHERE h.owner_user_id IS NOT NULL
      AND ps.settings_json ? 'ai.openrouter_key'
      AND btrim(COALESCE(ps.settings_json ->> 'ai.openrouter_key', '')) <> ''
    ORDER BY h.owner_user_id, ps.updated_at DESC, p.created_at DESC, p.id DESC
) AS source
ON CONFLICT (app_user_id)
DO UPDATE SET
    secrets_json = account_secrets.secrets_json || EXCLUDED.secrets_json,
    updated_at = now();

UPDATE profile_settings
SET settings_json = settings_json - 'ai.openrouter_key',
    updated_at = now()
WHERE settings_json ? 'ai.openrouter_key';
