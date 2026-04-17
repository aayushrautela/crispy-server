import type { AiCredentialSource } from '../ai/ai.types.js';

export type RecommendationWorkerDisplayMedia = {
  mediaType: string;
  mediaKey: string;
  provider: string;
  providerId: string;
  title: string;
};

export type RecommendationWorkerContinueWatchingProgress = {
  positionSeconds: number | null;
  durationSeconds: number | null;
  progressPercent: number;
  lastPlayedAt?: string;
};

export type RecommendationWorkerContinueWatchingItem = {
  id: string;
  media: RecommendationWorkerDisplayMedia;
  progress: RecommendationWorkerContinueWatchingProgress;
  lastActivityAt: string;
  payload?: Record<string, unknown>;
};

export type RecommendationWorkerGenerateRequest = {
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
    continueWatching?: RecommendationWorkerContinueWatchingItem[];
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

export type RecommendationWorkerGenerationStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export type RecommendationWorkerFailure = {
  code: string;
  message: string;
  retryable?: boolean;
  details?: Record<string, unknown> | null;
};

export type RecommendationWorkerSubmitResponse = {
  jobId: string;
  status: RecommendationWorkerGenerationStatus;
  idempotencyKey: string;
  acceptedAt?: string | null;
  statusUrl?: string | null;
  pollAfterSeconds?: number | null;
};

export type RecommendationWorkerStatusResponse = {
  jobId: string;
  status: RecommendationWorkerGenerationStatus;
  idempotencyKey: string;
  acceptedAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  cancelledAt?: string | null;
  pollAfterSeconds?: number | null;
  result?: RecommendationWorkerGenerateResponse | null;
  failure?: RecommendationWorkerFailure | null;
};

export type RecommendationWorkerGenerateResponse = {
  tasteProfile: Record<string, unknown>;
  recommendationSnapshot: Record<string, unknown>;
  generation?: Record<string, unknown> | null;
};
