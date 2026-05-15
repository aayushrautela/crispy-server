import { withDbClient } from '../../lib/db.js';
import { SupabaseAdminWatchReadService } from '../integrations/supabase-admin-watch-read.service.js';
import { metadataCardToMediaItem } from '../metadata/media-item.mapper.js';
import { EpisodicFollowService } from '../watch/episodic-follow.service.js';
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
      defaults: ProfileInputSignalLimitDefaults;
      cacheService?: ProfileInputSignalCacheService;
      watchReadService?: SupabaseAdminWatchReadService;
      episodicFollowService?: EpisodicFollowService;
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
    const livePayload = await this.fetchLivePayload(input, liveRequests);
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
      diagnostics: cache ?? {
        sourceMode: 'live',
        schemaVersion: 0,
        generatedAt: now,
        decisions: [],
        cacheReadAttempted: false,
        cacheWriteAttempted: false,
      },
    };
  }

  private async fetchLivePayload(input: GetProfileInputSignalBundleInput, requests: ProfileInputSignalCacheFamilyRequest[]): Promise<ProfileInputSignalCacheSectionPayload> {
    if (requests.length === 0) {
      return {};
    }

    return withDbClient(async (client) => {
      const payload: ProfileInputSignalCacheSectionPayload = {};
      const watchReadService = this.deps.watchReadService ?? new SupabaseAdminWatchReadService();
      const episodicFollowService = this.deps.episodicFollowService ?? new EpisodicFollowService();

      await Promise.all(requests.map(async (request) => {
        const params = {
          accountId: input.accountId,
          profileId: input.profileId,
          limit: request.requestedLimit,
        };

        switch (request.family) {
          case 'history': {
            const page = await watchReadService.listHistoryPage(client, params);
            payload.history = page.items.map((item) => ({
              id: item.id,
              mediaItem: item.mediaItem,
              watchedAt: item.watchedAt,
              payload: {
                eventType: item.eventType,
                occurredAt: item.occurredAt,
                origins: item.origins,
              },
            }));
            break;
          }
          case 'ratings': {
            const page = await watchReadService.listRatingsPage(client, params);
            payload.ratings = page.items.map((item) => ({
              id: item.id,
              mediaItem: item.mediaItem,
              rating: item.rating,
              payload: { origins: item.origins },
            }));
            break;
          }
          case 'watchlist': {
            const page = await watchReadService.listWatchlistPage(client, params);
            payload.watchlist = page.items.map((item) => ({
              id: item.id,
              mediaItem: item.mediaItem,
              addedAt: item.addedAt,
              payload: { origins: item.origins },
            }));
            break;
          }
          case 'continueWatching': {
            const page = await watchReadService.listContinueWatchingPage(client, params);
            payload.continueWatching = page.items.map((item) => ({
              id: item.id,
              mediaItem: item.mediaItem,
              progress: {
                progressPercent: item.progress.progressPercent,
              },
              lastActivityAt: item.lastActivityAt,
            }));
            break;
          }
          case 'trackedSeries': {
            await watchReadService.assertProfileAccess(client, { accountId: input.accountId, profileId: input.profileId });
            const items = await episodicFollowService.listForProfile(client, input.profileId, request.requestedLimit);
            payload.trackedSeries = items.map((item) => ({
              show: item.show ? metadataCardToMediaItem(item.show) : null,
              reason: item.reason ?? 'watch_activity',
              lastInteractedAt: item.lastInteractedAt,
              nextEpisodeAirDate: item.nextEpisodeAirDate,
              nextEpisodeMediaKey: item.nextEpisodeMediaKey,
              nextEpisodeSeasonNumber: item.nextEpisodeSeasonNumber,
              nextEpisodeEpisodeNumber: item.nextEpisodeEpisodeNumber,
              nextEpisodeAbsoluteEpisodeNumber: item.nextEpisodeAbsoluteEpisodeNumber,
              nextEpisodeTitle: item.nextEpisodeTitle,
              metadataRefreshedAt: item.metadataRefreshedAt,
              payload: item.payload,
            }));
            break;
          }
        }
      }));

      return payload;
    });
  }

  private normalizeIncludes(include?: ProfileInputSignalInclude[]): ProfileInputSignalInclude[] {
    if (!include) return DEFAULT_INCLUDES;
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
