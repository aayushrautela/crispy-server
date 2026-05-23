import type { AiCredentialSource } from '../ai/ai.types.js';
import type {
  ProfileInputWatchHistoryItem,
  ProfileInputRatingItem,
  ProfileInputWatchlistItem,
  ProfileInputTrackedSeriesItem,
} from './profile-input-signal.types.js';

export type RecommendationSignalDisplayMedia = {
  mediaType: string;
  itemId: string;
  title: string;
};

export type RecommendationSignalContinueWatchingProgress = {
  positionSeconds: number | null;
  durationSeconds: number | null;
  progressPercent: number;
  lastPlayedAt?: string;
};

export type RecommendationSignalContinueWatchingItem = {
  id: string;
  media: RecommendationSignalDisplayMedia;
  progress: RecommendationSignalContinueWatchingProgress;
  lastActivityAt: string;
  payload?: Record<string, unknown>;
};

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
  watchHistory: ProfileInputWatchHistoryItem[];
  ratings: ProfileInputRatingItem[];
  watchlist: ProfileInputWatchlistItem[];
  profileContext: {
    profileName: string;
    isKids: boolean;
    watchDataOrigin: string;
  };
  aiConfig: {
    providerId: string;
    endpointUrl: string;
    httpReferer: string;
    title: string;
    model: string;
    apiKey: string;
    credentialSource: AiCredentialSource;
  };
  optionalExtras?: {
    continueWatching?: RecommendationSignalContinueWatchingItem[];
    trackedSeries?: ProfileInputTrackedSeriesItem[];
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
