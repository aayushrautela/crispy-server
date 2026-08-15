import { withDbClient } from '../../lib/db.js';
import { ProfileLocalService } from '../profiles/profile-local.service.js';
import { AccountSettingsRepository } from '../users/account-settings.repo.js';
import { resolveEffectiveMetadataLanguage, normalizeMetadataLanguage } from './metadata-language.js';
import { requestMemoize } from '../../lib/request-context.js';

export class MetadataLanguageService {
  constructor(
    private readonly profileLocalService = new ProfileLocalService(),
    private readonly accountSettingsRepository = new AccountSettingsRepository(),
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
    return requestMemoize(`lang:profile:${profileId}`, async () => {
      const fromProfile = await this.profileLocalService.getInterfaceLanguage(profileId);
      return normalizeMetadataLanguage(fromProfile);
    });
  }

  private async getAccountLanguage(accountId: string): Promise<string | null> {
    return requestMemoize(`lang:account:${accountId}`, async () => {
      return withDbClient(async (client) => {
        const settings = await this.accountSettingsRepository.getSettingsForUser(client, accountId);
        return normalizeMetadataLanguage(typeof settings.interfaceLanguage === 'string' ? settings.interfaceLanguage : null);
      });
    });
  }
}
