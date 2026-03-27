import { HttpError } from '../../lib/errors.js';
import { AccountSettingsService } from '../users/account-settings.service.js';

export type ProfileSecretField = 'ai.api_key';

export type ProfileSecretValue = {
  appUserId: string;
  key: ProfileSecretField;
  value: string;
  providerId: string;
};

export class ProfileSecretAccessService {
  constructor(
    private readonly accountSettingsService = new AccountSettingsService(),
  ) {}

  async getAiApiKeyForAccountProfile(accountId: string, profileId: string): Promise<ProfileSecretValue> {
    return this.getSecretForAccountProfile(accountId, profileId, 'ai.api_key');
  }

  async getSecretForAccountProfile(accountId: string, profileId: string, field: string): Promise<ProfileSecretValue> {
    if (field !== 'ai.api_key') {
      throw new HttpError(403, 'Secret field not allowed.');
    }

    const [secret, providerId] = await Promise.all([
      this.accountSettingsService.getSecretForAccountProfile(accountId, profileId, field),
      this.accountSettingsService.getAiProviderIdForUser(accountId),
    ]);

    return {
      appUserId: secret.appUserId,
      key: 'ai.api_key',
      value: secret.value,
      providerId,
    } satisfies ProfileSecretValue;
  }
}
