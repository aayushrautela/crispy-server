import type { ProfileInputSignalCacheDiagnostics } from './profile-input-signal-cache.types.js';
import type { MediaItem } from '../metadata/media-item.types.js';

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

export type ProfileInputWatchHistoryItem = {
  id: string;
  mediaItem: MediaItem;
  watchedAt: string;
  payload: Record<string, unknown> | null;
};

export type ProfileInputRatingItem = {
  id: string;
  mediaItem: MediaItem;
  rating: {
    value: number;
    ratedAt: string;
  };
  payload: Record<string, unknown> | null;
};

export type ProfileInputWatchlistItem = {
  id: string;
  mediaItem: MediaItem;
  addedAt: string;
  payload: Record<string, unknown> | null;
};

export type ProfileInputContinueWatchingItem = {
  id: string;
  mediaItem: MediaItem;
  progress: {
    progressPercent: number;
  };
  lastActivityAt: string;
};

export type ProfileInputTrackedSeriesItem = {
  show: MediaItem | null;
  reason: string;
  lastInteractedAt: string | null;
  nextEpisodeAirDate: string | null;
  nextEpisodeMediaKey: string | null;
  nextEpisodeSeasonNumber: number | null;
  nextEpisodeEpisodeNumber: number | null;
  nextEpisodeAbsoluteEpisodeNumber: number | null;
  nextEpisodeTitle: string | null;
  metadataRefreshedAt: string | null;
  payload: Record<string, unknown> | null;
};

export type GetProfileInputSignalBundleInput = {
  accountId: string;
  profileId: string;
  include?: ProfileInputSignalInclude[];
  limits?: ProfileInputSignalLimits;
};

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
  diagnostics: ProfileInputSignalCacheDiagnostics;
};
