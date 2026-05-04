import type { AppAuditRepo } from './app-audit.repo.js';
import type { AppAuthorizationService } from './app-authorization.service.js';
import type { Clock } from './clock.js';
import type { ProfileEligibilityService } from './profile-eligibility.service.js';
import type { ProfileInputSignalFacade } from '../recommendations/profile-input-signal.facade.js';
import type { ProfileInputSignalBundle } from '../recommendations/profile-input-signal.types.js';
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
      facade: ProfileInputSignalFacade;
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

    const liveSignals = await this.deps.facade.getBundle({
      accountId: input.accountId,
      profileId: input.profileId,
      include: this.mapToFacadeIncludes(include),
      limits: {
        historyLimit: limits.historyLimit,
        ratingsLimit: limits.ratingsLimit,
        watchlistLimit: limits.watchlistLimit,
        continueLimit: limits.continueLimit,
      },
    });

    const bundle: ProfileSignalBundle['bundle'] = {
      signalsVersion: liveSignals.signalsVersion,
      generatedAt: liveSignals.generatedAt,
    };

    if (include.includes('history') && liveSignals.history) {
      bundle.history = this.mapHistory(liveSignals.history);
    }
    if (include.includes('ratings') && liveSignals.ratings) {
      bundle.ratings = this.mapRatings(liveSignals.ratings);
    }
    if (include.includes('watchlist') && liveSignals.watchlist) {
      bundle.watchlist = this.mapWatchlist(liveSignals.watchlist);
    }
    if (include.includes('continue') && liveSignals.continueWatching) {
      bundle.continueWatching = this.mapContinueWatching(liveSignals.continueWatching);
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

  private mapToFacadeIncludes(include: ProfileSignalInclude[]) {
    return include.flatMap((item) => {
      if (item === 'continue') return ['continue' as const];
      if (item === 'history' || item === 'ratings' || item === 'watchlist') return [item];
      return [];
    });
  }

  private mapHistory(history: NonNullable<ProfileInputSignalBundle['history']>) {
    return history.map((item) => ({
      mediaKey: mediaKeyFor(item),
      contentType: item.media.mediaType,
      watchedAt: new Date(item.watchedAt),
      progressPercent: 100,
      completionState: 'completed',
      durationSeconds: null,
    }));
  }

  private mapRatings(ratings: NonNullable<ProfileInputSignalBundle['ratings']>) {
    return ratings.map((item) => ({
      mediaKey: mediaKeyFor(item),
      rating: item.rating.value,
      ratedAt: new Date(item.rating.ratedAt),
      ratingSource: null,
    }));
  }

  private mapWatchlist(watchlist: NonNullable<ProfileInputSignalBundle['watchlist']>) {
    return watchlist.map((item) => ({
      mediaKey: mediaKeyFor(item),
      addedAt: new Date(item.addedAt),
    }));
  }

  private mapContinueWatching(continueWatching: NonNullable<ProfileInputSignalBundle['continueWatching']>) {
    return continueWatching.map((item) => ({
      mediaKey: mediaKeyFor(item),
      seasonNumber: null,
      episodeNumber: null,
      progressPercent: item.progress.progressPercent,
      updatedAt: new Date(item.lastActivityAt),
    }));
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

function mediaKeyFor(item: { id: string; media: { mediaKey?: string | null } }): string {
  return item.media.mediaKey ?? item.id;
}

function clamp(value: number | undefined, defaultValue: number, max: number): number {
  if (value === undefined) return defaultValue;
  return Math.min(Math.max(value, 0), max);
}
