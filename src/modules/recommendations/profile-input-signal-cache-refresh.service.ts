import { logger } from '../../config/logger.js';
import type { ProfileInputSignalFacade } from './profile-input-signal.facade.js';
import type { ProfileInputSignalCacheRepo } from './profile-input-signal-cache.repo.js';
import type { ProfileInputSignalFamily } from './profile-input-signal-cache.types.js';

export interface ProfileInputSignalCacheRefreshJob {
  accountId: string;
  profileId: string;
  families?: ProfileInputSignalFamily[];
  reason: 'scheduled' | 'manual' | 'backfill';
}

export class ProfileInputSignalCacheRefreshService {
  constructor(
    private readonly deps: {
      facade: ProfileInputSignalFacade;
      repo: ProfileInputSignalCacheRepo;
      log?: Pick<typeof logger, 'info' | 'warn' | 'error'>;
    },
  ) {}

  async refreshProfile(job: ProfileInputSignalCacheRefreshJob): Promise<{ success: boolean; familiesRefreshed: number; error?: string }> {
    const log = this.deps.log ?? logger;
    try {
      const bundle = await this.deps.facade.getBundle({
        accountId: job.accountId,
        profileId: job.profileId,
        include: job.families
          ? job.families.map((f) => this.familyToInclude(f))
          : ['history', 'ratings', 'watchlist', 'continue', 'trackedSeries'],
      });

      const familiesRefreshed = [
        bundle.history ? 1 : 0,
        bundle.ratings ? 1 : 0,
        bundle.watchlist ? 1 : 0,
        bundle.continueWatching ? 1 : 0,
        bundle.trackedSeries ? 1 : 0,
      ].reduce((a, b) => a + b, 0);

      log.info({
        event: 'profile_input_signal_cache_background_refresh_success',
        accountId: job.accountId,
        profileId: job.profileId,
        familiesRefreshed,
        reason: job.reason,
      });

      return { success: true, familiesRefreshed };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'refresh failed';
      log.error({
        event: 'profile_input_signal_cache_background_refresh_failed',
        err: error,
        accountId: job.accountId,
        profileId: job.profileId,
        reason: job.reason,
      });
      return { success: false, familiesRefreshed: 0, error: errorMsg };
    }
  }

  private familyToInclude(family: ProfileInputSignalFamily): 'history' | 'ratings' | 'watchlist' | 'continue' | 'trackedSeries' {
    switch (family) {
      case 'history':
        return 'history';
      case 'ratings':
        return 'ratings';
      case 'watchlist':
        return 'watchlist';
      case 'continueWatching':
        return 'continue';
      case 'trackedSeries':
        return 'trackedSeries';
    }
  }
}
