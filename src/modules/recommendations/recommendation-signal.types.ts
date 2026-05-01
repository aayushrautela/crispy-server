import type { AiCredentialSource } from '../ai/ai.types.js';

export type RecommendationSignalDisplayMedia = {
  mediaType: string;
  mediaKey: string;
  provider: string;
  providerId: string;
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
  watchHistory: unknown[];
  ratings: unknown[];
  watchlist: unknown[];
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
    trackedSeries?: unknown[];
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
