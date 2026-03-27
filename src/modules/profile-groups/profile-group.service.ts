import { appConfig } from '../../config/app-config.js';
import type { DbClient } from '../../lib/db.js';
import { ProfileGroupRepository } from './profile-group.repo.js';
import { ProfileRepository } from '../profiles/profile.repo.js';

export class ProfileGroupService {
  constructor(
    private readonly profileGroupRepository = new ProfileGroupRepository(),
    private readonly profileRepository = new ProfileRepository(),
  ) {}

  async ensureDefaultProfileGroup(client: DbClient, params: { userId: string }): Promise<string> {
    const memberships = await this.profileGroupRepository.findMembershipsForUser(client, params.userId);
    const existing = memberships[0]?.profileGroupId;
    if (existing) {
      return existing;
    }

    const profileGroupId = await this.profileGroupRepository.createDefaultProfileGroup(client, {
      userId: params.userId,
      profileGroupName: appConfig.defaults.profileGroupName,
    });

    await this.profileRepository.create(client, {
      profileGroupId,
      name: appConfig.defaults.profileName,
      sortOrder: 0,
      createdByUserId: params.userId,
    });

    return profileGroupId;
  }

  async getPrimaryProfileGroupId(client: DbClient, userId: string): Promise<string | null> {
    const memberships = await this.profileGroupRepository.findMembershipsForUser(client, userId);
    return memberships[0]?.profileGroupId ?? null;
  }
}
