import type { AppPrincipal } from './app-principal.types.js';

export type ProfileSignalInclude = 'profileContext' | 'history' | 'ratings' | 'watchlist' | 'continue' | 'language' | 'taste' | 'negativeSignals' | 'recentImpressions';
export interface ProfileSignalBundleQuery {
  include?: string;
  historyLimit?: number;
  ratingsLimit?: number;
  watchlistLimit?: number;
  continueLimit?: number;
  since?: string;
}

export interface GetProfileSignalBundleInput {
  principal: AppPrincipal;
  accountId: string;
  profileId: string;
  purpose: 'recommendation-generation';
  include?: ProfileSignalInclude[];
  limits?: {
    historyLimit?: number;
    ratingsLimit?: number;
    watchlistLimit?: number;
    continueLimit?: number;
  };
  since?: Date;
}

export interface ProfileSignalBundle {
  accountId: string;
  profileId: string;
  purpose: 'recommendation-generation';
  eligibility: { eligible: boolean; eligibilityVersion: number };
  bundle: {
    signalsVersion: number;
    generatedAt: Date;
    profileContext: ProfileContextSignal;
    language?: ProfileLanguageSignals;
    taste?: ProfileTasteSignals;
    history?: ProfileHistorySignal[];
    ratings?: ProfileRatingSignal[];
    watchlist?: ProfileWatchlistSignal[];
    continueWatching?: ProfileContinueWatchingSignal[];
    negativeSignals?: ProfileNegativeSignal[];
    recentImpressions?: ProfileRecentImpressionSignal[];
  };
  limits: {
    historyLimitApplied?: number;
    ratingsLimitApplied?: number;
    watchlistLimitApplied?: number;
    continueLimitApplied?: number;
  };
}

export interface ProfileContextSignal { profileName: string; isKids: boolean; watchDataOrigin: 'server_sync'; language?: string; region?: string; }
export interface ProfileLanguageSignals { primary?: string | null; secondary: string[]; audioPreferences: string[]; subtitlePreferences: string[]; }
export interface ProfileTasteSignals { genres: Array<{ id: string; score: number }>; people: Array<{ id: string; score: number }>; keywords: Array<{ id: string; score: number }>; maturity?: { maxAllowedRating?: string | null }; }
export interface ProfileHistorySignal { mediaKey: string; contentType: string; watchedAt: Date; progressPercent: number; completionState: string; durationSeconds?: number | null; }
export interface ProfileRatingSignal { mediaKey: string; rating: number; ratedAt: Date; ratingSource?: string | null; }
export interface ProfileWatchlistSignal { mediaKey: string; addedAt: Date; }
export interface ProfileContinueWatchingSignal { mediaKey: string; seasonNumber?: number | null; episodeNumber?: number | null; progressPercent: number; updatedAt: Date; }
export interface ProfileNegativeSignal { mediaKey: string; reason: string; createdAt: Date; }
export interface ProfileRecentImpressionSignal { listKey: string; mediaKey: string; shownAt: Date; }

export interface SignalBaseInput { accountId: string; profileId: string; }
export interface SignalListInput extends SignalBaseInput { limit: number; since?: Date; }

export interface ProfileSignalBundleService {
  getBundle(input: GetProfileSignalBundleInput): Promise<ProfileSignalBundle>;
}

export interface ProfileSignalBundleLimitDefaults {
  historyDefault: number;
  historyMax: number;
  ratingsDefault: number;
  ratingsMax: number;
  watchlistDefault: number;
  watchlistMax: number;
  continueDefault: number;
  continueMax: number;
  tasteGenresMax: number;
  tastePeopleMax: number;
  tasteKeywordsMax: number;
}

export interface AppliedProfileSignalLimits {
  historyLimit: number;
  ratingsLimit: number;
  watchlistLimit: number;
  continueLimit: number;
}
