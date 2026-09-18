import { withDbClient, type DbClient } from '../../lib/db.js';
import { ProfileAccessService } from '../profiles/profile-access.service.js';
import { TasteProfileRepository } from './taste-profile.repo.js';
import type { TasteProfilePayload, TasteProfileInput } from './recommendation.types.js';

export type RecommendationTasteProfileInput = TasteProfileInput;

export class TasteProfileService {
  constructor(
    private readonly profileAccessService = new ProfileAccessService(),
    private readonly tasteProfileRepository = new TasteProfileRepository(),
  ) {}

  async listTasteProfilesForAccount(accountId: string, profileId: string): Promise<TasteProfilePayload[]> {
    return withDbClient(async (client) => {
      await this.requireOwnedProfile(client, accountId, profileId);
      return this.tasteProfileRepository.listForProfile(client, profileId);
    });
  }

  async getTasteProfileForAccount(accountId: string, profileId: string, sourceKey: string): Promise<TasteProfilePayload | null> {
    return withDbClient(async (client) => {
      await this.requireOwnedProfile(client, accountId, profileId);
      return this.tasteProfileRepository.findByProfileAndSourceKey(client, profileId, sourceKey);
    });
  }

  async upsertTasteProfileForAccount(accountId: string, profileId: string, input: RecommendationTasteProfileInput): Promise<TasteProfilePayload> {
    return withDbClient(async (client) => {
      await this.requireOwnedProfile(client, accountId, profileId);
      return this.tasteProfileRepository.upsert(client, { ...input, profileId });
    });
  }

  async getTasteProfileForAccountService(accountId: string, profileId: string, sourceKey: string): Promise<TasteProfilePayload | null> {
    return this.getTasteProfileForAccount(accountId, profileId, sourceKey);
  }

  async upsertTasteProfileForAccountService(
    accountId: string,
    profileId: string,
    input: RecommendationTasteProfileInput,
  ): Promise<TasteProfilePayload> {
    return this.upsertTasteProfileForAccount(accountId, profileId, input);
  }

  private async requireOwnedProfile(client: DbClient, accountId: string, profileId: string): Promise<void> {
    await this.profileAccessService.assertOwnedProfile(client, profileId, accountId);
  }
}
