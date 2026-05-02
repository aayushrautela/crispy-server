import { RecommendationDataService } from './recommendation-data.service.js';
import { PersonalMediaService } from '../watch/personal-media.service.js';
import type { ProfileInputSignalCacheService } from './profile-input-signal-cache.service.js';
import {
  familyLimit,
  includeToFamily,
  type ProfileInputSignalCacheFamilyRequest,
  type ProfileInputSignalCacheSectionPayload,
} from './profile-input-signal-cache.types.js';
import type {
  AppliedProfileInputSignalLimits,
  GetProfileInputSignalBundleInput,
  ProfileInputSignalBundle,
  ProfileInputSignalInclude,
  ProfileInputSignalLimitDefaults,
} from './profile-input-signal.types.js';

const DEFAULT_INCLUDES: ProfileInputSignalInclude[] = ['history', 'ratings', 'watchlist', 'continue', 'trackedSeries'];

export class ProfileInputSignalFacade {
  constructor(
    private readonly deps: {
      recommendationDataService?: RecommendationDataService;
      personalMediaService?: PersonalMediaService;
      defaults: ProfileInputSignalLimitDefaults;
      cacheService?: ProfileInputSignalCacheService;
    },
  ) {}

  async getBundle(input: GetProfileInputSignalBundleInput): Promise<ProfileInputSignalBundle> {
    const include = this.normalizeIncludes(input.include);
    const limits = this.applyLimits(input.limits);
    const now = new Date();
    const requests = include.map((requestedInclude) => {
      const family = includeToFamily(requestedInclude);
      return { family, include: requestedInclude, requestedLimit: familyLimit(family, limits) };
    });

    const cacheService = this.deps.cacheService;
    const cacheRead = cacheService
      ? await cacheService.readUsableSections({
          accountId: input.accountId,
          profileId: input.profileId,
          requests,
          now,
        })
      : undefined;

    const liveRequests = cacheRead?.liveRequests ?? requests;
    const livePayload = await this.fetchLivePayload(input.accountId, input.profileId, liveRequests, limits);
    const cachePayload = cacheRead?.payload ?? {};
    const payload = { ...cachePayload, ...livePayload };

    const cacheWrite = cacheService
      ? await cacheService.writeSections({
          accountId: input.accountId,
          profileId: input.profileId,
          requests: liveRequests,
          payload: livePayload,
          now,
        })
      : { attempted: false };

    const cache = cacheService
      ? {
          sourceMode: cacheService.resolveSourceMode({
            decisions: cacheRead?.diagnostics.decisions ?? requests.map((request) => ({
              family: request.family,
              source: 'live' as const,
              reason: cacheService.policy.forceLive ? 'force_live' as const : 'cache_read_disabled' as const,
            })),
            cacheWriteAttempted: cacheWrite.attempted,
          }),
          schemaVersion: cacheService.policy.schemaVersion,
          generatedAt: now,
          decisions: cacheRead?.diagnostics.decisions ?? [],
          cacheReadAttempted: cacheRead?.diagnostics.cacheReadAttempted ?? false,
          cacheWriteAttempted: cacheWrite.attempted,
          ...(cacheRead?.diagnostics.cacheReadError ? { cacheReadError: cacheRead.diagnostics.cacheReadError } : {}),
          ...(cacheWrite.error ? { cacheWriteError: cacheWrite.error } : {}),
        }
      : undefined;

    return {
      accountId: input.accountId,
      profileId: input.profileId,
      signalsVersion: 0,
      generatedAt: now,
      ...(payload.history ? { history: payload.history } : {}),
      ...(payload.ratings ? { ratings: payload.ratings } : {}),
      ...(payload.watchlist ? { watchlist: payload.watchlist } : {}),
      ...(payload.continueWatching ? { continueWatching: payload.continueWatching } : {}),
      ...(payload.trackedSeries ? { trackedSeries: payload.trackedSeries } : {}),
      limits,
      ...(cache ? { cache } : {}),
    };
  }

  private async fetchLivePayload(
    accountId: string,
    profileId: string,
    requests: ProfileInputSignalCacheFamilyRequest[],
    limits: AppliedProfileInputSignalLimits,
  ): Promise<ProfileInputSignalCacheSectionPayload> {
    const recommendationDataService = this.deps.recommendationDataService ?? new RecommendationDataService();
    const personalMediaService = this.deps.personalMediaService ?? new PersonalMediaService();

    const payload: ProfileInputSignalCacheSectionPayload = {};
    await Promise.all(
      requests.map(async (request) => {
        switch (request.family) {
          case 'history':
            payload.history = await recommendationDataService.getWatchHistoryForAccountService(accountId, profileId, limits.historyLimit);
            return;
          case 'ratings':
            payload.ratings = await recommendationDataService.getRatingsForAccountService(accountId, profileId, limits.ratingsLimit);
            return;
          case 'watchlist':
            payload.watchlist = await recommendationDataService.getWatchlistForAccountService(accountId, profileId, limits.watchlistLimit);
            return;
          case 'continueWatching':
            payload.continueWatching = await personalMediaService.listContinueWatchingProducts(accountId, profileId, limits.continueLimit);
            return;
          case 'trackedSeries':
            payload.trackedSeries = await recommendationDataService.getEpisodicFollowForAccountService(
              accountId,
              profileId,
              limits.trackedSeriesLimit,
            );
            return;
        }
      }),
    );
    return payload;
  }

  private normalizeIncludes(include?: ProfileInputSignalInclude[]): ProfileInputSignalInclude[] {
    if (!include?.length) return DEFAULT_INCLUDES;
    return [...new Set(include)];
  }

  private applyLimits(requested?: GetProfileInputSignalBundleInput['limits']): AppliedProfileInputSignalLimits {
    return {
      historyLimit: clamp(requested?.historyLimit, this.deps.defaults.historyDefault, this.deps.defaults.historyMax),
      ratingsLimit: clamp(requested?.ratingsLimit, this.deps.defaults.ratingsDefault, this.deps.defaults.ratingsMax),
      watchlistLimit: clamp(requested?.watchlistLimit, this.deps.defaults.watchlistDefault, this.deps.defaults.watchlistMax),
      continueLimit: clamp(requested?.continueLimit, this.deps.defaults.continueDefault, this.deps.defaults.continueMax),
      trackedSeriesLimit: clamp(requested?.trackedSeriesLimit, this.deps.defaults.trackedSeriesDefault, this.deps.defaults.trackedSeriesMax),
    };
  }
}

function clamp(value: number | undefined, defaultValue: number, max: number): number {
  if (value === undefined) return defaultValue;
  return Math.min(Math.max(value, 0), max);
}
