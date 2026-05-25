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
import type { BaseItemDto } from '../metadata/media-item.types.js';
import type { RecoItemRef, RecoMediaType, RecoProviderRef } from '../recommendations/reco-contract.types.js';

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
      bundle.history = liveSignals.history.flatMap((item) => {
        const recoItem = toRecoItemRef(item.Item);
        if (!recoItem) return [];
        return [{
          item: recoItem,
          watchedAt: new Date(item.watchedAt),
          progressPercent: readNumber(item.payload?.progressPercent, 100),
          completionState: readCompletionState(item.payload?.completionState),
          durationSeconds: item.Item.RunTimeTicks !== null ? item.Item.RunTimeTicks / 10_000_000 : null,
        }];
      });
    }
    if (liveSignals.ratings) {
      bundle.ratings = liveSignals.ratings.flatMap((item) => {
        const recoItem = toRecoItemRef(item.Item);
        if (!recoItem) return [];
        return [{
          item: recoItem,
          rating: item.rating.value,
          ratedAt: new Date(item.rating.ratedAt),
          ratingSource: readOptionalString(item.payload?.ratingSource),
        }];
      });
    }
    if (liveSignals.watchlist) {
      bundle.watchlist = liveSignals.watchlist.flatMap((item) => {
        const recoItem = toRecoItemRef(item.Item);
        if (!recoItem) return [];
        return [{
          item: recoItem,
          addedAt: new Date(item.addedAt),
        }];
      });
    }
    if (liveSignals.continueWatching) {
      bundle.continueWatching = liveSignals.continueWatching.flatMap((item) => {
        const recoItem = toRecoItemRef(item.Item);
        if (!recoItem) return [];
        return [{
          item: recoItem,
          progressPercent: item.progress.progressPercent,
          updatedAt: new Date(item.lastActivityAt),
        }];
      });
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

function readCompletionState(value: unknown): 'completed' | 'partial' | 'unknown' {
  if (value === 'completed' || value === 'partial' || value === 'unknown') return value;
  return 'completed';
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function toRecoItemRef(item: BaseItemDto): RecoItemRef | null {
  const type = toRecoMediaType(item.Type);
  if (!type) return null;
  return {
    type,
    providerRefs: toProviderRefs(item),
    hints: {
      title: item.Name,
      originalTitle: item.OriginalTitle,
      year: item.ProductionYear,
      releaseDate: item.PremiereDate,
    },
  };
}

function toRecoMediaType(type: BaseItemDto['Type']): RecoMediaType | null {
  switch (type) {
    case 'Movie': return 'movie';
    case 'Series': return 'tv';
    default: return null;
  }
}

function toProviderRefs(item: BaseItemDto): RecoProviderRef[] {
  const refs: RecoProviderRef[] = [];
  if (item.ProviderIds.Tmdb) refs.push({ provider: 'tmdb', providerId: item.ProviderIds.Tmdb });
  if (item.ProviderIds.Tvdb) refs.push({ provider: 'tvdb', providerId: item.ProviderIds.Tvdb });
  if (item.ProviderIds.Imdb) refs.push({ provider: 'imdb', providerId: item.ProviderIds.Imdb });
  return refs;
}
