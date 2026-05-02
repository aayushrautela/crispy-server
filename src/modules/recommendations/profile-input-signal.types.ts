import type { RecommendationDataService } from './recommendation-data.service.js';
import type { PersonalMediaService } from '../watch/personal-media.service.js';
import type { ProfileInputSignalCacheDiagnostics } from './profile-input-signal-cache.types.js';

export type ProfileInputSignalInclude = 'history' | 'ratings' | 'watchlist' | 'continue' | 'trackedSeries';

export type ProfileInputSignalLimitDefaults = {
  historyDefault: number;
  historyMax: number;
  ratingsDefault: number;
  ratingsMax: number;
  watchlistDefault: number;
  watchlistMax: number;
  continueDefault: number;
  continueMax: number;
  trackedSeriesDefault: number;
  trackedSeriesMax: number;
};

export type ProfileInputSignalLimits = {
  historyLimit?: number;
  ratingsLimit?: number;
  watchlistLimit?: number;
  continueLimit?: number;
  trackedSeriesLimit?: number;
};

export type AppliedProfileInputSignalLimits = {
  historyLimit: number;
  ratingsLimit: number;
  watchlistLimit: number;
  continueLimit: number;
  trackedSeriesLimit: number;
};

export type ProfileInputWatchHistoryItem = Awaited<ReturnType<RecommendationDataService['getWatchHistoryForAccountService']>>[number];
export type ProfileInputRatingItem = Awaited<ReturnType<RecommendationDataService['getRatingsForAccountService']>>[number];
export type ProfileInputWatchlistItem = Awaited<ReturnType<RecommendationDataService['getWatchlistForAccountService']>>[number];
export type ProfileInputContinueWatchingItem = Awaited<ReturnType<PersonalMediaService['listContinueWatchingProducts']>>[number];
export type ProfileInputTrackedSeriesItem = Awaited<ReturnType<RecommendationDataService['getEpisodicFollowForAccountService']>>[number];

export type ProfileInputSignalBundle = {
  accountId: string;
  profileId: string;
  signalsVersion: number;
  generatedAt: Date;
  history?: ProfileInputWatchHistoryItem[];
  ratings?: ProfileInputRatingItem[];
  watchlist?: ProfileInputWatchlistItem[];
  continueWatching?: ProfileInputContinueWatchingItem[];
  trackedSeries?: ProfileInputTrackedSeriesItem[];
  limits: AppliedProfileInputSignalLimits;
  cache?: ProfileInputSignalCacheDiagnostics;
};

export type GetProfileInputSignalBundleInput = {
  accountId: string;
  profileId: string;
  include?: ProfileInputSignalInclude[];
  limits?: ProfileInputSignalLimits;
};
