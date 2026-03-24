import { withTransaction } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { HouseholdService } from '../households/household.service.js';
import { normalizeSettingsPatch, stripAccountScopedProfileSettings } from '../users/account-settings.service.js';
import { ProfileRepository, type ProfileRecord } from './profile.repo.js';
import { ProfileSettingsRepository } from './profile-settings.repo.js';

export class ProfileService {
  constructor(
    private readonly householdService = new HouseholdService(),
    private readonly profileRepository = new ProfileRepository(),
    private readonly profileSettingsRepository = new ProfileSettingsRepository(),
  ) {}

  async listForUser(userId: string): Promise<ProfileRecord[]> {
    return withTransaction(async (client) => {
      const householdId = await this.householdService.ensureDefaultHousehold(client, { userId });
      return this.profileRepository.listForHousehold(client, householdId);
    });
  }

  async create(userId: string, input: { name: string; avatarKey?: string | null; isKids?: boolean; sortOrder?: number }): Promise<ProfileRecord> {
    return withTransaction(async (client) => {
      const householdId = await this.householdService.ensureDefaultHousehold(client, { userId });
      const existing = await this.profileRepository.listForHousehold(client, householdId);
      const profile = await this.profileRepository.create(client, {
        householdId,
        name: input.name.trim(),
        avatarKey: input.avatarKey ?? null,
        isKids: input.isKids ?? false,
        sortOrder: input.sortOrder ?? existing.length,
        createdByUserId: userId,
      });
      await this.profileSettingsRepository.patchForProfile(client, profile.id, {});
      return profile;
    });
  }

  async update(userId: string, profileId: string, input: { name?: string; avatarKey?: string | null; isKids?: boolean; sortOrder?: number }): Promise<ProfileRecord> {
    return withTransaction(async (client) => {
      const updated = await this.profileRepository.update(client, {
        profileId,
        userId,
        name: input.name?.trim(),
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

  async getSettings(userId: string, profileId: string): Promise<Record<string, unknown>> {
    return withTransaction(async (client) => {
      const profile = await this.profileRepository.findByIdForUser(client, profileId, userId);
      if (!profile) {
        throw new HttpError(404, 'Profile not found.');
      }
      const settings = await this.profileSettingsRepository.getForProfile(client, profileId);
      return stripAccountScopedProfileSettings(settings);
    });
  }

  async patchSettings(userId: string, profileId: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    return withTransaction(async (client) => {
      const profile = await this.profileRepository.findByIdForUser(client, profileId, userId);
      if (!profile) {
        throw new HttpError(404, 'Profile not found.');
      }
      const normalizedPatch = normalizeSettingsPatch(patch);
      const settings = await this.profileSettingsRepository.patchForProfile(client, profileId, normalizedPatch);
      return stripAccountScopedProfileSettings(settings);
    });
  }

  async requireOwnedProfile(userId: string, profileId: string): Promise<ProfileRecord> {
    return withTransaction(async (client) => {
      const profile = await this.profileRepository.findByIdForUser(client, profileId, userId);
      if (!profile) {
        throw new HttpError(404, 'Profile not found.');
      }
      return profile;
    });
  }
}
