import type { AppAuditRepo } from './app-audit.repo.js';
import type { AppAuthorizationService } from './app-authorization.service.js';
import type { Clock } from './clock.js';
import type { ProfileEligibilityService } from './profile-eligibility.service.js';
import type { ProfileInputSignalFacade } from '../recommendations/profile-input-signal.facade.js';
import type { ProfileAccessService } from '../profiles/profile-access.service.js';
import { withDbClient } from '../../lib/db.js';
import type {
  AppliedProfileSignalLimits,
  GetProfileSignalBundleInput,
  ProfileSignalBundle,
  ProfileSignalBundleLimitDefaults,
  ProfileSignalBundleService,
  ProfileSignalInclude,
} from './profile-signal-bundle.types.js';
import type { ProfileInputSignalInclude } from '../recommendations/profile-input-signal.types.js';

const DEFAULT_INCLUDES: ProfileSignalInclude[] = ['profileContext', 'history', 'ratings', 'watchlist', 'continue', 'language', 'taste'];

export class DefaultProfileSignalBundleService implements ProfileSignalBundleService {
  constructor(
    private readonly deps: {
      facade: ProfileInputSignalFacade;
      profileEligibilityService: ProfileEligibilityService;
      appAuthorizationService: AppAuthorizationService;
      profileAccessService: ProfileAccessService;
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

    const profile = await withDbClient((client) =>
      this.deps.profileAccessService.assertOwnedProfile(client, input.profileId, input.accountId)
    );

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
      profileContext: {
        profileName: profile.name,
        isKids: profile.isKids,
        watchDataOrigin: 'server_sync',
      },
    };

    if (liveSignals.history) {
      bundle.history = liveSignals.history.map((item) => ({
        mediaKey: item.mediaItem.Id,
        contentType: item.mediaItem.Type,
        watchedAt: new Date(item.watchedAt),
        progressPercent: readNumber(item.payload?.progressPercent, 100),
        completionState: readString(item.payload?.completionState, 'completed'),
        durationSeconds: item.mediaItem.RunTimeTicks !== null ? item.mediaItem.RunTimeTicks / 10_000_000 : null,
      }));
    }
    if (liveSignals.ratings) {
      bundle.ratings = liveSignals.ratings.map((item) => ({
        mediaKey: item.mediaItem.Id,
        rating: item.rating.value,
        ratedAt: new Date(item.rating.ratedAt),
        ratingSource: readOptionalString(item.payload?.ratingSource),
      }));
    }
    if (liveSignals.watchlist) {
      bundle.watchlist = liveSignals.watchlist.map((item) => ({
        mediaKey: item.mediaItem.Id,
        addedAt: new Date(item.addedAt),
      }));
    }
    if (liveSignals.continueWatching) {
      bundle.continueWatching = liveSignals.continueWatching.map((item) => ({
        mediaKey: item.mediaItem.Id,
        seasonNumber: item.mediaItem.ParentIndexNumber,
        episodeNumber: item.mediaItem.IndexNumber,
        progressPercent: item.progress.progressPercent,
        updatedAt: new Date(item.lastActivityAt),
      }));
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

  private mapToFacadeIncludes(include: ProfileSignalInclude[]): ProfileInputSignalInclude[] {
    const mapped = include.flatMap((item): ProfileInputSignalInclude[] => {
      switch (item) {
        case 'history':
          return ['history'];
        case 'ratings':
          return ['ratings'];
        case 'watchlist':
          return ['watchlist'];
        case 'continue':
          return ['continue'];
        default:
          return [];
      }
    });
    return [...new Set(mapped)];
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

function readNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}
