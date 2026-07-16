import type {
  RecoContinueSignal,
  RecoHistorySignal,
  RecoRatingSignal,
  RecoWatchlistSignal,
} from './reco-contract.types.js';

export type RecommendationSignalBundle = {
  identity: {
    accountId: string;
    profileId: string;
  };
  generationMeta: {
    sourceKey: string;
    algorithmVersion: 'v3.2.1';
    historyGeneration: number;
    sourceCursor?: string | null;
    ttlSeconds?: number;
  };
  watchHistory: RecoHistorySignal[];
  ratings: RecoRatingSignal[];
  watchlist: RecoWatchlistSignal[];
  profileContext: {
    profileName: string;
    isKids: boolean;
    watchDataOrigin: string;
  };
  optionalExtras?: {
    continueWatching?: RecoContinueSignal[];
    limits?: {
      watchHistory: number;
      ratings: number;
      watchlist: number;
      continueWatching: number;
      trackedSeries: number;
    };
  };
};

export type RecommendationSignalGenerationResponse = {
  tasteProfile: Record<string, unknown>;
  recommendationSnapshot: Record<string, unknown>;
  generation?: Record<string, unknown> | null;
};
