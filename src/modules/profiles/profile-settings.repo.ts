import type { SupabaseClient } from '@supabase/supabase-js';
import type { DbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { getSupabaseServiceRoleClient } from '../../lib/supabase.js';

type ProfilePreferencesRow = {
  settings_json: Record<string, unknown> | null;
};

export class ProfileSettingsRepository {
  constructor(private readonly supabase: SupabaseClient = getSupabaseServiceRoleClient()) {}

  async assertProfileOwned(_client: DbClient, profileId: string, accountId: string): Promise<void> {
    const { data, error } = await this.supabase
      .from('profiles')
      .select('id')
      .eq('id', profileId)
      .eq('account_id', accountId)
      .is('deleted_at', null)
      .maybeSingle();

    if (error) {
      throw new HttpError(502, `Supabase profile lookup failed: ${error.message}`);
    }
    if (!data) {
      throw new HttpError(404, 'Profile not found.');
    }
  }

  async getForProfile(_client: DbClient, profileId: string): Promise<Record<string, unknown>> {
    const { data, error } = await this.supabase
      .from('profile_preferences')
      .select('settings_json')
      .eq('profile_id', profileId)
      .maybeSingle();

    if (error) {
      throw new HttpError(502, `Supabase profile preferences read failed: ${error.message}`);
    }

    return asRecord((data as ProfilePreferencesRow | null)?.settings_json);
  }

  async getFieldForProfile(client: DbClient, profileId: string, fieldKey: string): Promise<string | null> {
    const settings = await this.getForProfile(client, profileId);
    const value = settings[fieldKey];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  async patchForProfile(_client: DbClient, profileId: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    const current = await this.getForProfile(_client, profileId);
    const settings = mergeSettings(current, patch);
    const { data, error } = await this.supabase
      .from('profile_preferences')
      .upsert({ profile_id: profileId, settings_json: settings, updated_at: new Date().toISOString() }, { onConflict: 'profile_id' })
      .select('settings_json')
      .single();

    if (error) {
      throw new HttpError(502, `Supabase profile preferences write failed: ${error.message}`);
    }

    return asRecord((data as ProfilePreferencesRow | null)?.settings_json);
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
