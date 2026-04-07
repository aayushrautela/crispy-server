import type { AiCredentialSource } from '../ai/ai.types.js';

export type RecommendationWorkerGenerateRequest = {
  identity: {
    accountId: string;
    profileId: string;
  };
  generationMeta: {
    sourceKey: string;
    algorithmVersion: string;
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
    continueWatching?: unknown[];
    episodicFollow?: unknown[];
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
