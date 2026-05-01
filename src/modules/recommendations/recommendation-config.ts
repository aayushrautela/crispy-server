import { env } from '../../config/env.js';

export const recommendationConfig = {
  sourceKey: 'default',
  algorithmVersion: env.recommendationAlgorithmVersion,
  generationTtlSeconds: env.recommendationGenerationTtlSeconds,
  payloadLimits: {
    watchHistory: 100,
    ratings: 100,
    watchlist: 100,
    continueWatching: 50,
    trackedSeries: 25,
  },
} as const;

export function resolveRecommendationSourceKey(value: unknown): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return recommendationConfig.sourceKey;
}

export function resolveRecommendationAlgorithmVersion(value: unknown): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return recommendationConfig.algorithmVersion;
}
