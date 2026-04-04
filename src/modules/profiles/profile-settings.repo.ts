import type { DbClient } from '../../lib/db.js';

export class ProfileSettingsRepository {
  async getForProfile(client: DbClient, profileId: string): Promise<Record<string, unknown>> {
    const result = await client.query(
      `
        SELECT settings_json
        FROM profile_settings
        WHERE profile_id = $1::uuid
      `,
      [profileId],
    );
    return (result.rows[0]?.settings_json as Record<string, unknown> | undefined) ?? {};
  }

  async getFieldForProfile(client: DbClient, profileId: string, fieldKey: string): Promise<string | null> {
    const result = await client.query(
      `
        SELECT settings_json ->> $2 AS field_value
        FROM profile_settings
        WHERE profile_id = $1::uuid
      `,
      [profileId, fieldKey],
    );
    return typeof result.rows[0]?.field_value === 'string' && result.rows[0].field_value.trim()
      ? result.rows[0].field_value.trim()
      : null;
  }

  async patchForProfile(client: DbClient, profileId: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    const result = await client.query(
      `
        INSERT INTO profile_settings (profile_id, settings_json, updated_at)
        VALUES ($1::uuid, $2::jsonb, now())
        ON CONFLICT (profile_id)
        DO UPDATE SET
          settings_json = profile_settings.settings_json || EXCLUDED.settings_json,
          updated_at = now()
        RETURNING settings_json
      `,
      [profileId, JSON.stringify(patch)],
    );
    return (result.rows[0]?.settings_json as Record<string, unknown> | undefined) ?? {};
  }
}
