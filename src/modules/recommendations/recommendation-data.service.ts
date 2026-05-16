import { ProfileLocalService } from '../profiles/profile-local.service.js';

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
    private readonly profileLocalService = new ProfileLocalService(),
  ) {}

  async listAccountProfiles(accountId: string): Promise<ProfileSummary[]> {
    const profiles = await this.profileLocalService.listForAccount(accountId);
    return profiles.map((profile) => ({
      id: profile.id,
      accountId,
      name: profile.name,
      isKids: profile.isKids,
      updatedAt: profile.updatedAt,
    }));
  }

  async listAccountProfilesForService(accountId: string): Promise<ProfileSummary[]> {
    const profiles = await this.profileLocalService.listForAccount(accountId);
    return profiles.map((profile) => ({
      id: profile.id,
      accountId,
      name: profile.name,
      isKids: profile.isKids,
      updatedAt: profile.updatedAt,
    }));
  }
}
