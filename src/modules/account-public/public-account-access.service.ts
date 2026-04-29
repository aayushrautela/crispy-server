import type { DbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import type { AuthActor, AuthScope } from '../auth/auth.types.js';
import { ProfileRepository, type ProfileRecord } from '../profiles/profile.repo.js';

export type PublicAccountScope =
  | 'profiles:read'
  | 'watch:read'
  | 'taste-profile:read'
  | 'recommendations:read';

const SCOPE_HIERARCHY: Record<string, PublicAccountScope[]> = {
  'profiles:read': ['profiles:read'],
  'watch:read': ['watch:read'],
  'taste-profile:read': ['taste-profile:read'],
  'recommendations:read': ['recommendations:read'],
};

export class PublicAccountAccessService {
  constructor(private readonly profileRepository = new ProfileRepository()) {}

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

  async requireOwnedProfile(client: DbClient, actor: AuthActor, profileId: string): Promise<ProfileRecord> {
    if (!actor.appUserId) {
      throw new HttpError(403, 'User authentication required.');
    }

    const profile = await this.profileRepository.findByIdForOwnerUser(client, profileId, actor.appUserId);
    if (!profile) {
      throw new HttpError(404, 'Profile not found.');
    }

    return profile;
  }

  async listVisibleProfiles(client: DbClient, actor: AuthActor): Promise<ProfileRecord[]> {
    if (!actor.appUserId) {
      throw new HttpError(403, 'User authentication required.');
    }

    return this.profileRepository.listForOwnerUser(client, actor.appUserId);
  }
}
