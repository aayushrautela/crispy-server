import type { RecoMediaType, RecoProviderRef } from './reco-contract.types.js';

export type RecommendationAiPlanErrorCode =
  | 'INVALID_AI_PLAN_REQUEST'
  | 'UNSUPPORTED_AI_PLAN_SCHEMA_VERSION'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'PROFILE_NOT_ELIGIBLE_FOR_RECOMMENDATIONS'
  | 'EMPTY_CANDIDATE_POOL'
  | 'AI_PLAN_TIMEOUT'
  | 'AI_PLAN_RATE_LIMITED'
  | 'AI_PLAN_PROVIDER_UNAVAILABLE'
  | 'AI_PLAN_INVALID_VENDOR_OUTPUT'
  | 'AI_PLAN_OUTPUT_VALIDATION_FAILED'
  | 'AI_PLAN_INTERNAL_ERROR';

export type RecommendationAiPlanConstraints = {
  maxItems: number;
  mediaTypes: string[];
  excludeWatched: boolean;
  excludeWatchlisted: boolean;
  minimumConfidence: number;
};

export type RecommendationAiPlanProfileContext = {
  accountId: string;
  profileId: string;
  displayName: string;
  maturityRating: string;
  preferredLanguages: string[];
  country: string;
};

export type RecommendationAiPlanMediaItem = {
  type: RecoMediaType;
  providerRefs: RecoProviderRef[];
  title: string;
  year?: number;
  overview?: string;
  genres?: string[];
  popularity?: number;
  watchedAt?: string;
  completionPercent?: number;
};

export type RecommendationAiPlanSignals = {
  watchHistory: RecommendationAiPlanMediaItem[];
  ratings: RecommendationAiPlanMediaItem[];
  watchlist: RecommendationAiPlanMediaItem[];
  negativeSignals: RecommendationAiPlanMediaItem[];
};

export type RecommendationAiPlanCandidate = RecommendationAiPlanMediaItem;

export type RecommendationAiPlanRequest = {
  schemaVersion: number;
  requestId: string;
  runId: string;
  listKey: string;
  intent: string;
  locale: string;
  timezone?: string;
  generatedAt: string;
  constraints: RecommendationAiPlanConstraints;
  profile: RecommendationAiPlanProfileContext;
  signals: RecommendationAiPlanSignals;
  candidatePool: RecommendationAiPlanCandidate[];
  debug?: {
    source?: string;
    signalBundleVersion?: number;
  };
};

export type RecommendationAiPlanItem = {
  rank: number;
  type: RecoMediaType;
  provider: string;
  providerId: string;
  title: string;
  score: number;
  confidence: number;
  reason: string;
  reasonCodes: string[];
};

export type RecommendationAiPlanResponse = {
  schemaVersion: number;
  requestId: string;
  runId: string;
  listKey: string;
  generatedAt: string;
  plan: {
    summary: string;
    items: RecommendationAiPlanItem[];
  };
  diagnostics: {
    aiPlanVersion: string;
    latencyMs: number;
  };
};

export type RecommendationAiPlanError = {
  error: {
    code: RecommendationAiPlanErrorCode;
    message: string;
    requestId: string;
    retryable: boolean;
  };
};
