import type { AppAuditRepo } from './app-audit.repo.js';
import type { AppAuthorizationService } from './app-authorization.service.js';
import type { Clock } from './clock.js';
import type { ProfileEligibilityService } from './profile-eligibility.service.js';
import type { ProfileSignalBundleRepo } from './profile-signal-bundle.repo.js';
import type {
  AppliedProfileSignalLimits,
  GetProfileSignalBundleInput,
  ProfileSignalBundle,
  ProfileSignalBundleLimitDefaults,
  ProfileSignalBundleService,
  ProfileSignalInclude,
} from './profile-signal-bundle.types.js';

const DEFAULT_INCLUDES: ProfileSignalInclude[] = ['history', 'ratings', 'watchlist', 'continue', 'language', 'taste'];

export class DefaultProfileSignalBundleService implements ProfileSignalBundleService {
  constructor(
    private readonly deps: {
      repo: ProfileSignalBundleRepo;
      profileEligibilityService: ProfileEligibilityService;
      appAuthorizationService: AppAuthorizationService;
      appAuditRepo: AppAuditRepo;
      clock: Clock;
      defaults: ProfileSignalBundleLimitDefaults;
    },
  ) {}

  async getBundle(input: GetProfileSignalBundleInput): Promise<ProfileSignalBundle> {
    this.deps.appAuthorizationService.requireScope({ principal: input.principal, scope: 'profiles:signals:read' });
    this.deps.appAuthorizationService.requireGrant({
      principal: input.principal,
      resourceType: 'profileSignals',
      resourceId: '*',
      purpose: input.purpose,
      action: 'read',
      accountId: input.accountId,
      profileId: input.profileId,
    });

    const eligibility = await this.deps.profileEligibilityService.assertEligible({
      principal: input.principal,
      accountId: input.accountId,
      profileId: input.profileId,
      purpose: input.purpose,
      requireAiPersonalization: true,
    });

    const include = this.normalizeIncludes(input.include);
    const limits = this.applyGrantAndServerLimits({ requested: input.limits });
    const bundle: ProfileSignalBundle['bundle'] = {
      signalsVersion: await this.deps.repo.getSignalsVersion({ accountId: input.accountId, profileId: input.profileId }),
      generatedAt: this.deps.clock.now(),
    };

    if (include.includes('language')) {
      const language = await this.deps.repo.getLanguageSignals({ accountId: input.accountId, profileId: input.profileId });
      if (language) bundle.language = language;
    }
    if (include.includes('taste')) {
      const taste = await this.deps.repo.getTasteSignals({ accountId: input.accountId, profileId: input.profileId });
      if (taste) bundle.taste = taste;
    }
    if (include.includes('history')) {
      bundle.history = await this.deps.repo.listHistory({ accountId: input.accountId, profileId: input.profileId, limit: limits.historyLimit, since: input.since });
    }
    if (include.includes('ratings')) {
      bundle.ratings = await this.deps.repo.listRatings({ accountId: input.accountId, profileId: input.profileId, limit: limits.ratingsLimit, since: input.since });
    }
    if (include.includes('watchlist')) {
      bundle.watchlist = await this.deps.repo.listWatchlist({ accountId: input.accountId, profileId: input.profileId, limit: limits.watchlistLimit, since: input.since });
    }
    if (include.includes('continue')) {
      bundle.continueWatching = await this.deps.repo.listContinueWatching({ accountId: input.accountId, profileId: input.profileId, limit: limits.continueLimit, since: input.since });
    }
    if (include.includes('negativeSignals')) {
      bundle.negativeSignals = await this.deps.repo.listNegativeSignals({ accountId: input.accountId, profileId: input.profileId, limit: limits.ratingsLimit, since: input.since });
    }
    if (include.includes('recentImpressions')) {
      bundle.recentImpressions = await this.deps.repo.listRecentImpressions({ accountId: input.accountId, profileId: input.profileId, limit: limits.historyLimit, since: input.since });
    }

    await this.deps.appAuditRepo.insert({
      appId: input.principal.appId,
      keyId: input.principal.keyId,
      action: 'profile_signal_bundle_read',
      accountId: input.accountId,
      profileId: input.profileId,
      resourceType: 'profileSignals',
      resourceId: '*',
      metadata: { include },
    });

    return {
      accountId: input.accountId,
      profileId: input.profileId,
      purpose: input.purpose,
      eligibility: { eligible: eligibility.eligible, eligibilityVersion: eligibility.eligibilityVersion },
      bundle,
      limits: {
        historyLimitApplied: limits.historyLimit,
        ratingsLimitApplied: limits.ratingsLimit,
        watchlistLimitApplied: limits.watchlistLimit,
        continueLimitApplied: limits.continueLimit,
      },
    };
  }

  private normalizeIncludes(include?: ProfileSignalInclude[]): ProfileSignalInclude[] {
    if (!include?.length) return DEFAULT_INCLUDES;
    return [...new Set(include)];
  }

  private applyGrantAndServerLimits(input: { requested?: GetProfileSignalBundleInput['limits'] }): AppliedProfileSignalLimits {
    return {
      historyLimit: clamp(input.requested?.historyLimit, this.deps.defaults.historyDefault, this.deps.defaults.historyMax),
      ratingsLimit: clamp(input.requested?.ratingsLimit, this.deps.defaults.ratingsDefault, this.deps.defaults.ratingsMax),
      watchlistLimit: clamp(input.requested?.watchlistLimit, this.deps.defaults.watchlistDefault, this.deps.defaults.watchlistMax),
      continueLimit: clamp(input.requested?.continueLimit, this.deps.defaults.continueDefault, this.deps.defaults.continueMax),
    };
  }
}

function clamp(value: number | undefined, defaultValue: number, max: number): number {
  if (value === undefined) return defaultValue;
  return Math.min(Math.max(value, 0), max);
}
