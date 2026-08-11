import { withDbClient, type DbClient } from '../../lib/db.js';
import { ProfileAccessService } from '../profiles/profile-access.service.js';
import { TasteProfileRepository, type TasteProfileRecord } from './taste-profile.repo.js';
import type { TasteProfilePayload, TasteVectors } from './recommendation.types.js';

export type RecommendationTasteProfileInput = {
  sourceKey: string;
  contentTypePref?: Record<string, unknown>;
  ratingTendency?: Record<string, unknown>;
  watchingPace?: string | null;
  aiSummary?: string | null;
  source: string;
  vectors: TasteVectors;
};

export class TasteProfileService {
  constructor(
    private readonly profileAccessService = new ProfileAccessService(),
    private readonly tasteProfileRepository = new TasteProfileRepository(),
  ) {}

  async listTasteProfilesForAccount(accountId: string, profileId: string): Promise<TasteProfilePayload[]> {
    return withDbClient(async (client) => {
      await this.requireOwnedProfile(client, accountId, profileId);
      const rows = await this.tasteProfileRepository.listForProfile(client, profileId);
      return rows.map((row) => mapTasteProfile(row));
    });
  }

  async getTasteProfileForAccount(accountId: string, profileId: string, sourceKey: string): Promise<TasteProfilePayload | null> {
    return withDbClient(async (client) => {
      await this.requireOwnedProfile(client, accountId, profileId);
      const row = await this.tasteProfileRepository.findByProfileAndSourceKey(client, profileId, sourceKey);
      return row ? mapTasteProfile(row) : null;
    });
  }

  async upsertTasteProfileForAccount(accountId: string, profileId: string, input: RecommendationTasteProfileInput): Promise<TasteProfilePayload> {
    return withDbClient(async (client) => {
      await this.requireOwnedProfile(client, accountId, profileId);
      const row = await this.tasteProfileRepository.upsert(client, {
        profileId,
        sourceKey: input.sourceKey,
        contentTypePref: input.contentTypePref,
        ratingTendency: input.ratingTendency,
        watchingPace: input.watchingPace,
        aiSummary: input.aiSummary,
        source: input.source,
        vectors: input.vectors,
      });
      return mapTasteProfile(row);
    });
  }

  async getTasteProfileForAccountService(accountId: string, profileId: string, sourceKey: string): Promise<TasteProfilePayload | null> {
    return withDbClient(async (client) => {
      const targetProfileId = await this.requireOwnedProfileForAccount(client, accountId, profileId);
      const row = await this.tasteProfileRepository.findByProfileAndSourceKey(client, targetProfileId, sourceKey);
      return row ? mapTasteProfile(row) : null;
    });
  }

  async upsertTasteProfileForAccountService(
    accountId: string,
    profileId: string,
    input: RecommendationTasteProfileInput,
  ): Promise<TasteProfilePayload> {
    return withDbClient(async (client) => {
      const targetProfileId = await this.requireOwnedProfileForAccount(client, accountId, profileId);
      const row = await this.tasteProfileRepository.upsert(client, {
        profileId: targetProfileId,
        sourceKey: input.sourceKey,
        contentTypePref: input.contentTypePref,
        ratingTendency: input.ratingTendency,
        watchingPace: input.watchingPace,
        aiSummary: input.aiSummary,
        source: input.source,
        vectors: input.vectors,
      });
      return mapTasteProfile(row);
    });
  }

  private async requireOwnedProfile(client: DbClient, accountId: string, profileId: string): Promise<void> {
    await this.profileAccessService.assertOwnedProfile(client, profileId, accountId);
  }

  private async requireOwnedProfileForAccount(client: DbClient, accountId: string, profileId: string): Promise<string> {
    const profile = await this.profileAccessService.assertOwnedProfile(client, profileId, accountId);
    return profile.id;
  }
}

function mapTasteProfile(row: TasteProfileRecord): TasteProfilePayload {
  return {
    profileId: row.profileId,
    sourceKey: row.sourceKey,
    contentTypePref: row.contentTypePref,
    ratingTendency: row.ratingTendency,
    watchingPace: row.watchingPace,
    aiSummary: row.aiSummary,
    source: row.source,
    vectors: row.vectors,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
