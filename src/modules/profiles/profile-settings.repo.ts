import type { DbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';

export class ProfileSettingsRepository {
  async assertProfileOwned(client: DbClient, profileId: string, accountId: string): Promise<void> {
    const result = await client.query(
      `SELECT id FROM identity.profiles WHERE id = $1::uuid AND account_id = $2::uuid AND deleted_at IS NULL`,
      [profileId, accountId],
    );
    if (!result.rows[0]) {
      throw new HttpError(404, 'Profile not found.');
    }
  }

  async getForProfile(client: DbClient, profileId: string): Promise<Record<string, unknown>> {
    const result = await client.query(
      `SELECT settings_json FROM identity.profile_preferences WHERE profile_id = $1::uuid`,
      [profileId],
    );
    return asRecord(result.rows[0]?.settings_json);
  }

  async getFieldForProfile(client: DbClient, profileId: string, fieldKey: string): Promise<string | null> {
    const settings = await this.getForProfile(client, profileId);
    const value = settings[fieldKey];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  async patchForProfile(client: DbClient, profileId: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    const current = await this.getForProfile(client, profileId);
    const settings = mergeSettings(current, patch);
    const result = await client.query(
      `INSERT INTO identity.profile_preferences (profile_id, settings_json, updated_at)
       VALUES ($1::uuid, $2::jsonb, now())
       ON CONFLICT (profile_id)
       DO UPDATE SET settings_json = $2::jsonb, updated_at = now()
       RETURNING settings_json`,
      [profileId, JSON.stringify(settings)],
    );
    return asRecord(result.rows[0]?.settings_json);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function mergeSettings(current: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    const existing = next[key];
    next[key] = isRecord(existing) && isRecord(value) ? { ...existing, ...value } : value;
  }
  return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
