import type { DbClient } from '../../lib/db.js';

export class AccountSettingsRepository {
  async getSettingsForUser(client: DbClient, userId: string): Promise<Record<string, unknown>> {
    const result = await client.query(
      `
        SELECT settings_json
        FROM account_settings
        WHERE app_user_id = $1::uuid
      `,
      [userId],
    );
    return (result.rows[0]?.settings_json as Record<string, unknown> | undefined) ?? {};
  }

  async patchSettingsForUser(client: DbClient, userId: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    const result = await client.query(
      `
        INSERT INTO account_settings (app_user_id, settings_json, updated_at)
        VALUES ($1::uuid, $2::jsonb, now())
        ON CONFLICT (app_user_id)
        DO UPDATE SET
          settings_json = account_settings.settings_json || EXCLUDED.settings_json,
          updated_at = now()
        RETURNING settings_json
      `,
      [userId, JSON.stringify(patch)],
    );
    return (result.rows[0]?.settings_json as Record<string, unknown> | undefined) ?? {};
  }

  async getSecretForUser(client: DbClient, userId: string, fieldKey: string): Promise<string | null> {
    const result = await client.query(
      `
        SELECT secrets_json ->> $2 AS field_value
        FROM account_secrets
        WHERE app_user_id = $1::uuid
      `,
      [userId, fieldKey],
    );
    return typeof result.rows[0]?.field_value === 'string' && result.rows[0].field_value.trim()
      ? result.rows[0].field_value.trim()
      : null;
  }

  async setSecretForUser(client: DbClient, userId: string, fieldKey: string, value: string): Promise<void> {
    await client.query(
      `
        INSERT INTO account_secrets (app_user_id, secrets_json, updated_at)
        VALUES ($1::uuid, jsonb_build_object($2::text, $3::text), now())
        ON CONFLICT (app_user_id)
        DO UPDATE SET
          secrets_json = account_secrets.secrets_json || jsonb_build_object($2::text, $3::text),
          updated_at = now()
      `,
      [userId, fieldKey, value],
    );
  }

  async deleteSecretForUser(client: DbClient, userId: string, fieldKey: string): Promise<boolean> {
    const result = await client.query(
      `
        UPDATE account_secrets
        SET secrets_json = secrets_json - $2::text,
            updated_at = now()
        WHERE app_user_id = $1::uuid
          AND secrets_json ? $2::text
        RETURNING app_user_id
      `,
      [userId, fieldKey],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
