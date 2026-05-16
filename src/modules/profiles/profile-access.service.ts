import type { DbClient } from '../../lib/db.js';
import { ProfileLocalService, type ProfileRecord } from './profile-local.service.js';

export class ProfileAccessService {
  constructor(
    private readonly profileLocalService = new ProfileLocalService(),
  ) {}

  async assertOwnedProfile(_client: DbClient, profileId: string, accountId: string): Promise<ProfileRecord> {
    return this.profileLocalService.requireOwnedProfile(accountId, profileId);
  }

  async findOwnerUserId(_client: DbClient, profileId: string): Promise<string | null> {
    try {
      return await this.profileLocalService.requireProfileOwnerAccountId(profileId);
    } catch {
      return null;
    }
  }
}
