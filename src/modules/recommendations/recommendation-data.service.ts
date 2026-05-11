import { withDbClient, type DbClient } from '../../lib/db.js';
import { ProfileAccessService } from '../profiles/profile-access.service.js';
import { ProfileRepository, type ProfileRecord } from '../profiles/profile.repo.js';

export type RecommendationDataListKind = never;

type ProfileSummary = {
  id: string;
  accountId: string | null;
  name: string;
  isKids: boolean;
  updatedAt: string;
};

export class RecommendationDataService {
  constructor(
    private readonly profileAccessService = new ProfileAccessService(),
    private readonly profileRepository = new ProfileRepository(),
  ) {}

  async listAccountProfiles(accountId: string): Promise<ProfileSummary[]> {
    return withDbClient(async (client) => {
      const profiles = await this.profileRepository.listForOwnerUser(client, accountId);
      return Promise.all(profiles.map((profile) => toProfileSummary(this.profileAccessService, client, profile)));
    });
  }

  async listAccountProfilesForService(accountId: string): Promise<ProfileSummary[]> {
    return withDbClient(async (client) => {
      const profiles = await this.profileRepository.listForOwnerUser(client, accountId);
      return Promise.all(profiles.map((profile) => toProfileSummary(this.profileAccessService, client, profile)));
    });
  }
}

async function toProfileSummary(
  profileAccessService: ProfileAccessService,
  client: DbClient,
  profile: ProfileRecord,
): Promise<ProfileSummary> {
  const accountId = await profileAccessService.findOwnerUserId(client, profile.id);
  return {
    id: profile.id,
    accountId,
    name: profile.name,
    isKids: profile.isKids,
    updatedAt: profile.updatedAt,
  };
}
