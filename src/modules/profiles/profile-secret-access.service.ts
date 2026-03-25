import { withTransaction, type DbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { AccountSettingsService } from '../users/account-settings.service.js';
import { ProfileRepository } from './profile.repo.js';

export type ProfileSecretField = 'ai.openrouter_key';

export type ProfileSecretValue = {
  appUserId: string;
  key: ProfileSecretField;
  value: string;
};

type TransactionRunner = <T>(work: (client: DbClient) => Promise<T>) => Promise<T>;

export class ProfileSecretAccessService {
  constructor(
    private readonly accountSettingsService = new AccountSettingsService(),
    private readonly profileRepository = new ProfileRepository(),
    private readonly runInTransaction: TransactionRunner = withTransaction,
  ) {}

  async getOpenRouterKeyForAccountProfile(accountId: string, profileId: string): Promise<ProfileSecretValue> {
    return this.getSecretForAccountProfile(accountId, profileId, 'ai.openrouter_key');
  }

  async getAiApiKeyForAccountProfile(accountId: string, profileId: string): Promise<ProfileSecretValue> {
    return this.getOpenRouterKeyForAccountProfile(accountId, profileId);
  }

  async getSecretForAccountProfile(accountId: string, profileId: string, field: string): Promise<ProfileSecretValue> {
    if (field !== 'ai.openrouter_key') {
      throw new HttpError(403, 'Secret field not allowed.');
    }

    return this.runInTransaction(async (client) => {
      const profile = await this.profileRepository.findByIdForOwnerUser(client, profileId, accountId);
      if (!profile) {
        throw new HttpError(404, 'Profile not found for account.');
      }

      const secret = await this.accountSettingsService.getSecretForAccountProfile(accountId, profile.id, field);
      return {
        appUserId: secret.appUserId,
        key: 'ai.openrouter_key',
        value: secret.value,
      } satisfies ProfileSecretValue;
    });
  }
}
