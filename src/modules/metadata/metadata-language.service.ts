import { withTransaction } from '../../lib/db.js';
import { getSupabaseServiceRoleClient } from '../../lib/supabase.js';
import { ProfileSettingsRepository } from '../profiles/profile-settings.repo.js';
import { SupabaseAccountSettingsRepository } from '../users/supabase-account-settings.repo.js';
import { resolveEffectiveMetadataLanguage, normalizeMetadataLanguage } from './metadata-language.js';

export class MetadataLanguageService {
  constructor(
    private readonly profileSettingsRepository = new ProfileSettingsRepository(),
    private readonly accountSettingsRepository = new SupabaseAccountSettingsRepository(getSupabaseServiceRoleClient()),
  ) {}

  async resolveForProfile(profileId: string, accountId: string, explicitLanguage?: string | null): Promise<string> {
    const normalizedExplicit = normalizeMetadataLanguage(explicitLanguage);
    if (normalizedExplicit) {
      return normalizedExplicit;
    }

    return resolveEffectiveMetadataLanguage(
      null,
      await this.getProfileLanguage(profileId),
      await this.getAccountLanguage(accountId),
    );
  }

  async resolveForAccount(accountId: string, explicitLanguage?: string | null): Promise<string> {
    const normalizedExplicit = normalizeMetadataLanguage(explicitLanguage);
    if (normalizedExplicit) {
      return normalizedExplicit;
    }

    return resolveEffectiveMetadataLanguage(
      null,
      null,
      await this.getAccountLanguage(accountId),
    );
  }

  private async getProfileLanguage(profileId: string): Promise<string | null> {
    return withTransaction(async (client) => {
      const value = await this.profileSettingsRepository.getFieldForProfile(client, profileId, 'interfaceLanguage');
      return normalizeMetadataLanguage(typeof value === 'string' ? value : null);
    });
  }

  private async getAccountLanguage(accountId: string): Promise<string | null> {
    return withTransaction(async (client) => {
      const settings = await this.accountSettingsRepository.getSettingsForUser(client, accountId);
      return normalizeMetadataLanguage(typeof settings.interfaceLanguage === 'string' ? settings.interfaceLanguage : null);
    });
  }
}
