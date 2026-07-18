import { withDbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { ProfileAccessService } from '../profiles/profile-access.service.js';
import { ProfileSettingsRepository } from '../profiles/profile-settings.repo.js';
import { isHomeMode, type HomeMode } from './homescreen.types.js';

const HOME_MODE_FIELD = 'homeMode';

export const DEFAULT_HOME_MODE: HomeMode = 'recommended';

export class HomeModeService {
  constructor(
    private readonly profileAccessService = new ProfileAccessService(),
    private readonly settingsRepository = new ProfileSettingsRepository(),
  ) {}

  async getMode(accountId: string, profileId: string): Promise<HomeMode> {
    return withDbClient(async (client) => {
      await this.profileAccessService.assertOwnedProfile(client, profileId, accountId);
      const settings = await this.settingsRepository.getForProfile(client, profileId);
      const value = settings[HOME_MODE_FIELD];
      return isHomeMode(value) ? value : DEFAULT_HOME_MODE;
    });
  }

  async setMode(accountId: string, profileId: string, mode: HomeMode): Promise<HomeMode> {
    if (!isHomeMode(mode)) {
      throw new HttpError(400, 'Invalid homeMode. Expected "recommended" or "custom".');
    }
    return withDbClient(async (client) => {
      await this.profileAccessService.assertOwnedProfile(client, profileId, accountId);
      await this.settingsRepository.patchForProfile(client, profileId, { [HOME_MODE_FIELD]: mode });
      return mode;
    });
  }

  /**
   * Guard used before any write to a profile's home. A manual or reco write is
   * only allowed when the profile mode permits it:
   *  - manual writes (source 'user') require mode 'custom'
   *  - reco writes (source 'service') are blocked when mode is 'custom'
   */
  async assertCanWrite(accountId: string, profileId: string, source: 'user' | 'service'): Promise<void> {
    const mode = await this.getMode(accountId, profileId);
    if (source === 'user' && mode !== 'custom') {
      throw new HttpError(
        409,
        'Cannot write a custom home while homeMode is "recommended". Set homeMode to "custom" first.',
        { field: HOME_MODE_FIELD, currentMode: mode },
        'home_mode_conflict',
      );
    }
    if (source === 'service' && mode === 'custom') {
      throw new HttpError(
        409,
        'Cannot overwrite a custom home with recommendations while homeMode is "custom".',
        { field: HOME_MODE_FIELD, currentMode: mode },
        'home_mode_conflict',
      );
    }
  }

  /** Read mode without ownership assertion (used by the resolver for display). */
  async getModeUnsafe(profileId: string): Promise<HomeMode> {
    return withDbClient(async (client) => {
      const settings = await this.settingsRepository.getForProfile(client, profileId);
      const value = settings[HOME_MODE_FIELD];
      return isHomeMode(value) ? value : DEFAULT_HOME_MODE;
    });
  }
}
