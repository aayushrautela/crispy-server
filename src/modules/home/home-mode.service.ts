import { withDbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { ProfileAccessService } from '../profiles/profile-access.service.js';
import { ProfileRepository } from '../profiles/profile.repo.js';
import type { HomeMode, HomeSource } from './home-types.js';

export const DEFAULT_HOME_MODE: HomeMode = 'recommended';

export function isHomeMode(value: unknown): value is HomeMode {
  return value === 'custom' || value === 'recommended';
}

export function toHomeMode(recommendationSource: string | null): HomeMode {
  return recommendationSource === 'custom' ? 'custom' : 'recommended';
}

export function fromHomeMode(mode: HomeMode): string {
  return mode === 'custom' ? 'custom' : 'reco';
}

export class HomeModeService {
  constructor(
    private readonly profileAccessService = new ProfileAccessService(),
    private readonly profileRepository = new ProfileRepository(),
  ) {}

  async getMode(accountId: string, profileId: string): Promise<HomeMode> {
    return withDbClient(async (client) => {
      await this.profileAccessService.assertOwnedProfile(client, profileId, accountId);
      const profile = await this.profileRepository.findByIdForOwnerUser(client, profileId, accountId);
      return toHomeMode(profile?.recommendationSource ?? null);
    });
  }

  async setMode(accountId: string, profileId: string, mode: HomeMode): Promise<HomeMode> {
    if (!isHomeMode(mode)) {
      throw new HttpError(400, 'Invalid homeMode. Expected "recommended" or "custom".');
    }
    return withDbClient(async (client) => {
      await this.profileAccessService.assertOwnedProfile(client, profileId, accountId);
      await this.profileRepository.setRecommendationSource(client, profileId, accountId, fromHomeMode(mode));
      return mode;
    });
  }

  /**
   * Guard used before any write to a profile's home. A custom write is only
   * allowed when the profile mode is 'custom'. A reco/fallback (service) write
   * is blocked when the profile mode is 'custom'.
   */
  async assertCanWrite(accountId: string, profileId: string, source: HomeSource): Promise<void> {
    const mode = await this.getMode(accountId, profileId);
    if (source === 'custom' && mode !== 'custom') {
      throw new HttpError(
        409,
        'Cannot write a custom home while homeMode is "recommended". Set homeMode to "custom" first.',
        { field: 'recommendationSource', currentMode: mode },
        'home_mode_conflict',
      );
    }
    if ((source === 'reco' || source === 'fallback') && mode === 'custom') {
      throw new HttpError(
        409,
        'Cannot overwrite a custom home with recommendations while homeMode is "custom".',
        { field: 'recommendationSource', currentMode: mode },
        'home_mode_conflict',
      );
    }
  }

  /** Read mode without ownership assertion (used by the resolver for display). */
  async getModeUnsafe(profileId: string): Promise<HomeMode> {
    return withDbClient(async (client) => {
      const profile = await this.profileRepository.findById(client, profileId);
      return toHomeMode(profile?.recommendationSource ?? null);
    });
  }
}
