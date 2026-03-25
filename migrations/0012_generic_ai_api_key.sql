UPDATE account_secrets
SET secrets_json = (secrets_json - 'ai.openrouter_key') || jsonb_build_object('ai.api_key', btrim(secrets_json ->> 'ai.openrouter_key')),
    updated_at = now()
WHERE secrets_json ? 'ai.openrouter_key'
  AND btrim(COALESCE(secrets_json ->> 'ai.openrouter_key', '')) <> ''
  AND (
    NOT (secrets_json ? 'ai.api_key')
    OR btrim(COALESCE(secrets_json ->> 'ai.api_key', '')) = ''
  );

UPDATE account_secrets
SET secrets_json = secrets_json - 'ai.openrouter_key',
    updated_at = now()
WHERE secrets_json ? 'ai.openrouter_key';

UPDATE profile_settings
SET settings_json = (settings_json - 'ai.openrouter_key') || jsonb_build_object('ai.api_key', btrim(settings_json ->> 'ai.openrouter_key')),
    updated_at = now()
WHERE settings_json ? 'ai.openrouter_key'
  AND btrim(COALESCE(settings_json ->> 'ai.openrouter_key', '')) <> ''
  AND (
    NOT (settings_json ? 'ai.api_key')
    OR btrim(COALESCE(settings_json ->> 'ai.api_key', '')) = ''
  );

UPDATE profile_settings
SET settings_json = settings_json - 'ai.openrouter_key',
    updated_at = now()
WHERE settings_json ? 'ai.openrouter_key';
