import { logger } from '../../config/logger.js';
import { db } from '../../lib/db.js';
import { SqlProfileInputSignalCacheRepo } from './profile-input-signal-cache.repo.js';
import type {
  ProfileInputSignalCacheInvalidationReason,
  ProfileInputSignalFamily,
} from './profile-input-signal-cache.types.js';

export class ProfileInputSignalCacheInvalidator {
  constructor(
    private readonly repo = new SqlProfileInputSignalCacheRepo({ db }),
    private readonly log: Pick<typeof logger, 'warn' | 'info'> = logger,
  ) {}

  async invalidate(input: {
    accountId: string;
    profileId: string;
    families: ProfileInputSignalFamily[];
    reason: ProfileInputSignalCacheInvalidationReason;
  }): Promise<void> {
    if (input.families.length === 0) return;
    try {
      await this.repo.invalidate(input);
      this.log.info(
        {
          event: 'profile_input_signal_cache_invalidation',
          accountId: input.accountId,
          profileId: input.profileId,
          families: input.families,
          reason: input.reason,
        },
        'profile input signal cache invalidated',
      );
    } catch (error) {
      this.log.warn(
        {
          event: 'profile_input_signal_cache_invalidation_failed',
          err: error,
          accountId: input.accountId,
          profileId: input.profileId,
          families: input.families,
          reason: input.reason,
        },
        'failed to invalidate profile input signal cache',
      );
    }
  }
}
