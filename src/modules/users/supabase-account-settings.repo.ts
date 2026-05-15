import type { SupabaseClient } from '@supabase/supabase-js';
import { type DbClient } from '../../lib/db.js';
import { encryptSecret, decryptSecret } from '../../lib/crypto.js';

export type AccountSecretRecord = {
  appUserId: string;
  value: string;
};

export class SupabaseAccountSettingsRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async getSettingsForUser(_client: DbClient, accountId: string): Promise<Record<string, unknown>> {
    const { data, error } = await this.supabase
      .from('account_preferences')
      .select('settings_json')
      .eq('account_id', accountId)
      .maybeSingle();

    if (error) throw error;
    return (data?.settings_json as Record<string, unknown> | undefined) ?? {};
  }

  async patchSettingsForUser(_client: DbClient, accountId: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    const current = await this.getSettingsForUser(_client, accountId);
    const merged = { ...current, ...patch };

    const { data, error } = await this.supabase
      .from('account_preferences')
      .upsert({ account_id: accountId, settings_json: merged, updated_at: new Date().toISOString() }, { onConflict: 'account_id' })
      .select('settings_json')
      .single();

    if (error) throw error;
    return (data?.settings_json as Record<string, unknown> | undefined) ?? {};
  }

  async getSecretForUser(_client: DbClient, accountId: string, fieldKey: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .from('account_secrets')
      .select('secrets_json')
      .eq('account_id', accountId)
      .maybeSingle();

    if (error) throw error;
    const encrypted: string | undefined = (data?.secrets_json as Record<string, string> | undefined)?.[fieldKey];
    if (!encrypted) return null;

    try {
      return decryptSecret(encrypted);
    } catch {
      return null;
    }
  }

  async setSecretForUser(_client: DbClient, accountId: string, fieldKey: string, value: string): Promise<void> {
    const encrypted = encryptSecret(value);

    const { data: current } = await this.supabase
      .from('account_secrets')
      .select('secrets_json')
      .eq('account_id', accountId)
      .maybeSingle();

    const merged = { ...((current?.secrets_json ?? {}) as Record<string, string>), [fieldKey]: encrypted };

    const { error } = await this.supabase
      .from('account_secrets')
      .upsert({ account_id: accountId, secrets_json: merged, updated_at: new Date().toISOString() }, { onConflict: 'account_id' });

    if (error) throw error;
  }

  async deleteSecretForUser(_client: DbClient, accountId: string, fieldKey: string): Promise<boolean> {
    const { data: current } = await this.supabase
      .from('account_secrets')
      .select('secrets_json')
      .eq('account_id', accountId)
      .maybeSingle();

    const secrets = { ...((current?.secrets_json ?? {}) as Record<string, string>) };
    if (!(fieldKey in secrets)) return false;
    delete secrets[fieldKey];

    const { error } = await this.supabase
      .from('account_secrets')
      .upsert({ account_id: accountId, secrets_json: secrets, updated_at: new Date().toISOString() }, { onConflict: 'account_id' });

    if (error) throw error;
    return true;
  }

  async listSecretsForField(_client: DbClient, fieldKey: string): Promise<AccountSecretRecord[]> {
    const { data, error } = await this.supabase
      .from('account_secrets')
      .select('account_id, secrets_json')
      .not('secrets_json', 'is', null);

    if (error) throw error;

    const results: AccountSecretRecord[] = [];
    for (const row of data ?? []) {
      const secrets = row.secrets_json as Record<string, string> | null;
      if (!secrets?.[fieldKey]) continue;
      try {
        results.push({
          appUserId: String(row.account_id),
          value: decryptSecret(secrets[fieldKey]),
        });
      } catch {
        // skip corrupt entries
      }
    }
    return results;
  }
}
