import { withTransaction, type DbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { ProfileRepository } from './profile.repo.js';
import { ProfileSettingsRepository } from './profile-settings.repo.js';

export type ProfileSecretField = 'ai.openrouter_key';

export type ProfileSecretValue = {
  profileId: string;
  key: ProfileSecretField;
  value: string;
};

type TransactionRunner = <T>(work: (client: DbClient) => Promise<T>) => Promise<T>;

export class ProfileSecretAccessService {
  constructor(
    private readonly profileRepository = new ProfileRepository(),
    private readonly settingsRepository = new ProfileSettingsRepository(),
    private readonly runInTransaction: TransactionRunner = withTransaction,
  ) {}

  async getOpenRouterKey(profileId: string): Promise<ProfileSecretValue> {
    return this.getSecret(profileId, 'ai.openrouter_key');
  }

  async getSecret(profileId: string, field: string): Promise<ProfileSecretValue> {
    if (field !== 'ai.openrouter_key') {
      throw new HttpError(403, 'Secret field not allowed.');
    }

    return this.runInTransaction(async (client) => {
      const profile = await this.profileRepository.findById(client, profileId);
      if (!profile) {
        throw new HttpError(404, 'Profile not found.');
      }

      const value = await this.settingsRepository.getFieldForProfile(client, profileId, field);
      if (!value) {
        throw new HttpError(404, 'Profile secret not found.');
      }

      return {
        profileId,
        key: field,
        value,
      } satisfies ProfileSecretValue;
    });
  }
}
