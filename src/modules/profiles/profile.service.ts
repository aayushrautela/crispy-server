import { withTransaction } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { ProfileGroupService } from '../profile-groups/profile-group.service.js';
import { normalizeProfileSettingsPatch, stripAccountScopedProfileSettings } from '../users/account-settings.service.js';
import { RecommendationOutboxService } from '../outbox/recommendation-outbox.service.js';
import { ProfileRepository, type ProfileRecord } from './profile.repo.js';
import { ProfileSettingsRepository } from './profile-settings.repo.js';

export class ProfileService {
  constructor(
    private readonly profileGroupService = new ProfileGroupService(),
    private readonly profileRepository = new ProfileRepository(),
    private readonly profileSettingsRepository = new ProfileSettingsRepository(),
    private readonly recommendationOutboxService = new RecommendationOutboxService(),
  ) {}

  async listForAccount(accountId: string): Promise<ProfileRecord[]> {
    return withTransaction(async (client) => {
      const profileGroupId = await this.profileGroupService.ensureDefaultProfileGroup(client, { userId: accountId });
      return this.profileRepository.listForProfileGroup(client, profileGroupId);
    });
  }

  async create(accountId: string, input: { name: string; interfaceLanguage?: string; region?: string | null; avatarKey?: string | null; isKids?: boolean; sortOrder?: number }): Promise<ProfileRecord> {
    return withTransaction(async (client) => {
      const profileGroupId = await this.profileGroupService.ensureDefaultProfileGroup(client, { userId: accountId });
      const existing = await this.profileRepository.listForProfileGroup(client, profileGroupId);
      const profile = await this.profileRepository.create(client, {
        profileGroupId,
        name: input.name.trim(),
        interfaceLanguage: input.interfaceLanguage ?? 'en',
        region: input.region ?? null,
        avatarKey: input.avatarKey ?? null,
        isKids: input.isKids ?? false,
        sortOrder: input.sortOrder ?? existing.length,
        createdByUserId: accountId,
      });
      await this.profileSettingsRepository.patchForProfile(client, profile.id, {});
      await this.recommendationOutboxService.appendRecomputeRequested(client, {
        userId: accountId,
        profileId: profile.id,
        reason: 'profile_created',
      });
      return profile;
    });
  }

  async update(accountId: string, profileId: string, input: { name?: string; interfaceLanguage?: string; region?: string | null; avatarKey?: string | null; isKids?: boolean; sortOrder?: number }): Promise<ProfileRecord> {
    return withTransaction(async (client) => {
      const updated = await this.profileRepository.update(client, {
        profileId,
        ownerUserId: accountId,
        name: input.name?.trim(),
        interfaceLanguage: input.interfaceLanguage,
        region: input.region,
        avatarKey: input.avatarKey,
        isKids: input.isKids,
        sortOrder: input.sortOrder,
      });
      if (!updated) {
        throw new HttpError(404, 'Profile not found.');
      }
      return updated;
    });
  }

  async getSettingsForAccount(accountId: string, profileId: string): Promise<Record<string, unknown>> {
    return withTransaction(async (client) => {
      const profile = await this.profileRepository.findByIdForOwnerUser(client, profileId, accountId);
      if (!profile) {
        throw new HttpError(404, 'Profile not found.');
      }
      const settings = await this.profileSettingsRepository.getForProfile(client, profileId);
      return stripAccountScopedProfileSettings(settings);
    });
  }

  async patchSettingsForAccount(accountId: string, profileId: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    return withTransaction(async (client) => {
      const profile = await this.profileRepository.findByIdForOwnerUser(client, profileId, accountId);
      if (!profile) {
        throw new HttpError(404, 'Profile not found.');
      }
      const normalizedPatch = normalizeProfileSettingsPatch(patch);
      const settings = await this.profileSettingsRepository.patchForProfile(client, profileId, normalizedPatch);
      await this.recommendationOutboxService.appendRecomputeRequested(client, {
        userId: accountId,
        profileId,
        reason: 'profile_settings_changed',
      });
      return stripAccountScopedProfileSettings(settings);
    });
  }

  async requireOwnedProfile(accountId: string, profileId: string): Promise<ProfileRecord> {
    return withTransaction(async (client) => {
      const profile = await this.profileRepository.findByIdForOwnerUser(client, profileId, accountId);
      if (!profile) {
        throw new HttpError(404, 'Profile not found.');
      }
      return profile;
    });
  }

  async requireProfileOwnerAccountId(profileId: string): Promise<string> {
    return withTransaction(async (client) => {
      const accountId = await this.profileRepository.findOwnerUserIdById(client, profileId);
      if (!accountId) {
        throw new HttpError(404, 'Profile not found.');
      }
      return accountId;
    });
  }
}
