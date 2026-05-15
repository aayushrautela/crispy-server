import type { DbClient } from '../../lib/db.js';
import { getSupabaseServiceRoleClient } from '../../lib/supabase.js';
import { SupabaseProfileService, type SupabaseProfileRecord } from './supabase-profile.service.js';

export class ProfileAccessService {
  constructor(
    private readonly supabaseProfileService = new SupabaseProfileService(getSupabaseServiceRoleClient()),
  ) {}

  async assertOwnedProfile(_client: DbClient, profileId: string, accountId: string): Promise<SupabaseProfileRecord> {
    return this.supabaseProfileService.requireOwnedProfile(accountId, profileId);
  }

  async findOwnerUserId(_client: DbClient, profileId: string): Promise<string | null> {
    try {
      return await this.supabaseProfileService.requireProfileOwnerAccountId(profileId);
    } catch {
      return null;
    }
  }
}
