import { getSupabaseServiceRoleClient } from '../../lib/supabase.js';
import { SupabaseProfileService } from '../profiles/supabase-profile.service.js';

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
    private readonly supabaseProfileService = new SupabaseProfileService(getSupabaseServiceRoleClient()),
  ) {}

  async listAccountProfiles(accountId: string): Promise<ProfileSummary[]> {
    const profiles = await this.supabaseProfileService.listForAccount(accountId);
    return profiles.map((profile) => ({
      id: profile.id,
      accountId,
      name: profile.name,
      isKids: profile.isKids,
      updatedAt: profile.updatedAt,
    }));
  }

  async listAccountProfilesForService(accountId: string): Promise<ProfileSummary[]> {
    const profiles = await this.supabaseProfileService.listForAccount(accountId);
    return profiles.map((profile) => ({
      id: profile.id,
      accountId,
      name: profile.name,
      isKids: profile.isKids,
      updatedAt: profile.updatedAt,
    }));
  }
}
