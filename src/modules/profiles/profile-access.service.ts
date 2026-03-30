import type { DbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { ProfileRepository, type ProfileRecord } from './profile.repo.js';

export class ProfileAccessService {
  constructor(private readonly profileRepository = new ProfileRepository()) {}

  async assertOwnedProfile(client: DbClient, profileId: string, accountId: string): Promise<ProfileRecord> {
    const profile = await this.profileRepository.findByIdForOwnerUser(client, profileId, accountId);
    if (!profile) {
      throw new HttpError(404, 'Profile not found.');
    }
    return profile;
  }

  async findOwnerUserId(client: DbClient, profileId: string): Promise<string | null> {
    return this.profileRepository.findOwnerUserIdById(client, profileId);
  }
}
