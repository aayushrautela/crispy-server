import { withTransaction, type DbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { AccountSettingsService } from '../users/account-settings.service.js';

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
    private readonly runInTransaction: TransactionRunner = withTransaction,
  ) {}

  async getOpenRouterKey(profileId: string): Promise<ProfileSecretValue> {
    return this.getSecret(profileId, 'ai.openrouter_key');
  }

  async getSecret(profileId: string, field: string): Promise<ProfileSecretValue> {
    if (field !== 'ai.openrouter_key') {
      throw new HttpError(403, 'Secret field not allowed.');
    }

    return this.runInTransaction(async () => {
      const secret = await this.accountSettingsService.getSecretForProfile(profileId, field);
      return {
        appUserId: secret.appUserId,
        key: 'ai.openrouter_key',
        value: secret.value,
      } satisfies ProfileSecretValue;
    });
  }
}
