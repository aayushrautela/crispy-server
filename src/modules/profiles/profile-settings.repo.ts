import type { DbClient } from '../../lib/db.js';

export class ProfileSettingsRepository {
  async getActiveRecommenderSource(profileId: string, client: DbClient): Promise<string | null> {
    const settings = await this.getForProfile(client, profileId);
    const recommendations = isRecord(settings.recommendations) ? settings.recommendations : null;
    return recommendations && typeof recommendations.activeSourceKey === 'string'
      ? recommendations.activeSourceKey
      : null;
  }

  async setActiveRecommenderSource(client: DbClient, profileId: string, sourceKey: string): Promise<Record<string, unknown>> {
    return this.patchForProfile(client, profileId, {
      recommendations: {
        activeSourceKey: sourceKey,
      },
    });
  }

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
