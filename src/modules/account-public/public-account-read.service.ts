import { withDbClient } from '../../lib/db.js';
import type { PublicAccountDto, PublicProfileDto, PublicProfileSummaryDto } from '../../http/contracts/account-public.js';
import type { AuthActor } from '../auth/auth.types.js';
import { PublicAccountAccessService } from './public-account-access.service.js';

export class PublicAccountReadService {
  constructor(private readonly accessService = new PublicAccountAccessService()) {}

  async getAccount(actor: AuthActor): Promise<PublicAccountDto> {
    this.accessService.requireScope(actor, 'profiles:read');

    const profiles = await withDbClient((client) => this.accessService.listVisibleProfiles(client, actor));

    return {
      id: requireAccountId(actor),
      email: actor.email,
      createdAt: new Date().toISOString(),
      profiles: profiles.map(mapProfileSummary),
    };
  }

  async listProfiles(actor: AuthActor): Promise<PublicProfileSummaryDto[]> {
    this.accessService.requireScope(actor, 'profiles:read');

    const profiles = await withDbClient((client) => this.accessService.listVisibleProfiles(client, actor));
    return profiles.map(mapProfileSummary);
  }

  async getProfile(actor: AuthActor, profileId: string): Promise<PublicProfileDto> {
    this.accessService.requireScope(actor, 'profiles:read');

    const profile = await withDbClient((client) => this.accessService.requireOwnedProfile(client, actor, profileId));
    return {
      ...mapProfileSummary(profile),
      profileGroupId: profile.profileGroupId,
    };
  }
}

function requireAccountId(actor: AuthActor): string {
  if (!actor.appUserId) {
    throw new Error('Authenticated user actor is missing account id.');
  }
  return actor.appUserId;
}

function mapProfileSummary(profile: {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}): PublicProfileSummaryDto {
  return {
    id: profile.id,
    name: profile.name,
    avatarUrl: null,
    isDefault: profile.sortOrder === 0,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}
