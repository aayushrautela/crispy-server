import type { SupabaseClient } from '@supabase/supabase-js';
import { db, type DbClient } from '../../lib/db.js';
import { encryptSecret, decryptSecret } from '../../lib/crypto.js';

export type AccountSecretRecord = {
  appUserId: string;
  value: string;
};

export class SupabaseAccountSettingsRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  private async resolveAccountId(_client: DbClient, localUserId: string): Promise<string> {
    const result = await db.query(
      `SELECT auth_subject FROM app_users WHERE id = $1::uuid`,
      [localUserId],
    );
    return result.rows[0]?.auth_subject ?? localUserId;
  }

  async getSettingsForUser(client: DbClient, userId: string): Promise<Record<string, unknown>> {
    const accountId = await this.resolveAccountId(client, userId);
    const { data, error } = await this.supabase
      .from('account_preferences')
      .select('settings_json')
      .eq('account_id', accountId)
      .maybeSingle();

    if (error) throw error;
    return (data?.settings_json as Record<string, unknown> | undefined) ?? {};
  }

  async patchSettingsForUser(client: DbClient, userId: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    const accountId = await this.resolveAccountId(client, userId);
    // Read current to merge
    const current = await this.getSettingsForUser(client, userId);
    const merged = { ...current, ...patch };

    const { data, error } = await this.supabase
      .from('account_preferences')
      .upsert({ account_id: accountId, settings_json: merged, updated_at: new Date().toISOString() }, { onConflict: 'account_id' })
      .select('settings_json')
      .single();

    if (error) throw error;
    return (data?.settings_json as Record<string, unknown> | undefined) ?? {};
  }

  async getSecretForUser(client: DbClient, userId: string, fieldKey: string): Promise<string | null> {
    const accountId = await this.resolveAccountId(client, userId);
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

  async setSecretForUser(client: DbClient, userId: string, fieldKey: string, value: string): Promise<void> {
    const accountId = await this.resolveAccountId(client, userId);
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

  async deleteSecretForUser(client: DbClient, userId: string, fieldKey: string): Promise<boolean> {
    const accountId = await this.resolveAccountId(client, userId);

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

  async listSecretsForField(client: DbClient, fieldKey: string): Promise<AccountSecretRecord[]> {
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
