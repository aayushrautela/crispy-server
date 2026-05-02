import type {
  AppliedProfileInputSignalLimits,
  ProfileInputContinueWatchingItem,
  ProfileInputRatingItem,
  ProfileInputSignalInclude,
  ProfileInputTrackedSeriesItem,
  ProfileInputWatchHistoryItem,
  ProfileInputWatchlistItem,
} from './profile-input-signal.types.js';

export const PROFILE_INPUT_SIGNAL_CACHE_SCHEMA_VERSION = 1;

export type ProfileInputSignalFamily = 'history' | 'ratings' | 'watchlist' | 'continueWatching' | 'trackedSeries';

export type ProfileInputSignalSourceMode =
  | 'live'
  | 'cache'
  | 'cache_with_live_fallback'
  | 'live_with_cache_write'
  | 'force_live';

export type ProfileInputSignalCacheGenerationReason =
  | 'read_through'
  | 'background_refresh'
  | 'manual_backfill'
  | 'repair'
  | 'test_fixture';

export type ProfileInputSignalCacheInvalidationReason =
  | 'watch_history_mutated'
  | 'playback_progress_mutated'
  | 'watchlist_mutated'
  | 'rating_mutated'
  | 'episodic_follow_mutated'
  | 'profile_context_mutated'
  | 'profile_deleted'
  | 'schema_version_changed'
  | 'manual_invalidation';

export type ProfileInputSignalCacheDecisionReason =
  | 'hit_fresh'
  | 'miss'
  | 'stale_ttl'
  | 'schema_mismatch'
  | 'invalidated'
  | 'partial_missing_family'
  | 'insufficient_limit_coverage'
  | 'payload_deserialization_failed'
  | 'cache_read_disabled'
  | 'cache_unavailable'
  | 'force_live'
  | 'family_not_allowed'
  | 'rollout_not_selected'
  | 'observe_only';

export type ProfileInputSignalCacheEmptyKind = 'known_empty' | 'not_empty' | 'unknown';

export type ProfileInputSignalCachePolicy = {
  forceLive: boolean;
  readEnabled: boolean;
  writeEnabled: boolean;
  observeOnly: boolean;
  schemaVersion: number;
  readRolloutPercent: number;
  allowedFamilies?: ProfileInputSignalFamily[];
  ttlSecondsByFamily: Record<ProfileInputSignalFamily, number>;
};

export type ProfileInputSignalCacheSectionPayload = {
  history?: ProfileInputWatchHistoryItem[];
  ratings?: ProfileInputRatingItem[];
  watchlist?: ProfileInputWatchlistItem[];
  continueWatching?: ProfileInputContinueWatchingItem[];
  trackedSeries?: ProfileInputTrackedSeriesItem[];
};

export type ProfileInputSignalCacheSection = {
  accountId: string;
  profileId: string;
  family: ProfileInputSignalFamily;
  schemaVersion: number;
  payload: unknown;
  itemCount: number;
  limitCoverage: number;
  materializedAt: Date;
  expiresAt?: Date;
  sourceVersion?: number;
  sourceLatestUpdatedAt?: Date;
  isComplete: boolean;
  emptyKind: ProfileInputSignalCacheEmptyKind;
  generationReason: ProfileInputSignalCacheGenerationReason;
  invalidatedAt?: Date;
  invalidationReason?: ProfileInputSignalCacheInvalidationReason;
};

export type ProfileInputSignalCacheWriteSection = {
  family: ProfileInputSignalFamily;
  payload: ProfileInputSignalCacheSectionPayload;
  itemCount: number;
  limitCoverage: number;
  sourceVersion?: number;
  sourceLatestUpdatedAt?: Date;
  expiresAt?: Date;
  isComplete: boolean;
  emptyKind: ProfileInputSignalCacheEmptyKind;
};

export type ProfileInputSignalCacheFamilyRequest = {
  family: ProfileInputSignalFamily;
  include: ProfileInputSignalInclude;
  requestedLimit: number;
};

export type ProfileInputSignalCacheFamilyDecision = {
  family: ProfileInputSignalFamily;
  source: 'cache' | 'live';
  reason: ProfileInputSignalCacheDecisionReason;
  itemCount?: number;
  cacheAgeMs?: number;
};

export type ProfileInputSignalCacheDiagnostics = {
  sourceMode: ProfileInputSignalSourceMode;
  schemaVersion: number;
  generatedAt: Date;
  decisions: ProfileInputSignalCacheFamilyDecision[];
  cacheReadAttempted: boolean;
  cacheWriteAttempted: boolean;
  cacheReadError?: string;
  cacheWriteError?: string;
};

export function familyLimit(family: ProfileInputSignalFamily, limits: AppliedProfileInputSignalLimits): number {
  switch (family) {
    case 'history':
      return limits.historyLimit;
    case 'ratings':
      return limits.ratingsLimit;
    case 'watchlist':
      return limits.watchlistLimit;
    case 'continueWatching':
      return limits.continueLimit;
    case 'trackedSeries':
      return limits.trackedSeriesLimit;
  }
}

export function includeToFamily(include: ProfileInputSignalInclude): ProfileInputSignalFamily {
  switch (include) {
    case 'history':
      return 'history';
    case 'ratings':
      return 'ratings';
    case 'watchlist':
      return 'watchlist';
    case 'continue':
      return 'continueWatching';
    case 'trackedSeries':
      return 'trackedSeries';
  }
}
