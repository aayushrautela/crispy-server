import type { DbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { getSupabaseServiceRoleClient } from '../../lib/supabase.js';
import type { AuthActor, AuthScope } from '../auth/auth.types.js';
import { SupabaseProfileService, type SupabaseProfileRecord } from '../profiles/supabase-profile.service.js';

export type PublicAccountScope =
  | 'profiles:read'
  | 'watch:read'
  | 'taste-profile:read'
  | 'taste-profile:write'
  | 'taste:write'
  | 'recommendations:read'
  | 'recommendations:write';

const SCOPE_HIERARCHY: Record<string, PublicAccountScope[]> = {
  'profiles:read': ['profiles:read'],
  'watch:read': ['watch:read'],
  'taste-profile:read': ['taste-profile:read'],
  'taste:write': ['taste:write', 'taste-profile:write'],
  'recommendations:read': ['recommendations:read'],
  'recommendations:write': ['recommendations:write'],
};

export class PublicAccountAccessService {
  constructor(
    private readonly supabaseProfileService = new SupabaseProfileService(getSupabaseServiceRoleClient()),
  ) {}

  requireScope(actor: AuthActor, scope: PublicAccountScope): void {
    const granted = new Set(actor.scopes);
    const required = SCOPE_HIERARCHY[scope] ?? [scope];
    
    for (const s of required) {
      if (granted.has(s as AuthScope)) {
        return;
      }
    }
    
    throw new HttpError(403, `Missing required scope: ${scope}`);
  }

  async requireOwnedProfile(_client: DbClient, actor: AuthActor, profileId: string): Promise<SupabaseProfileRecord> {
    if (!actor.appUserId) {
      throw new HttpError(403, 'User authentication required.');
    }

    return this.supabaseProfileService.requireOwnedProfile(actor.appUserId, profileId);
  }

  async listVisibleProfiles(_client: DbClient, actor: AuthActor): Promise<SupabaseProfileRecord[]> {
    if (!actor.appUserId) {
      throw new HttpError(403, 'User authentication required.');
    }

    return this.supabaseProfileService.listForAccount(actor.appUserId);
  }
}
