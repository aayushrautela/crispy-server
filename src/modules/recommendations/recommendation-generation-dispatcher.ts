import { logger } from '../../config/logger.js';
import { recommendationConfig } from './recommendation-config.js';

type EnqueueRecommendationGeneration = (profileId: string, delayMs?: number) => Promise<void>;

async function defaultEnqueueRecommendationGeneration(profileId: string, delayMs?: number): Promise<void> {
  const { enqueueRecommendationGeneration } = await import('../../lib/queue.js');
  await enqueueRecommendationGeneration(profileId, delayMs);
}

export class RecommendationGenerationDispatcher {
  constructor(
    private readonly enqueueRecommendationGeneration: EnqueueRecommendationGeneration = defaultEnqueueRecommendationGeneration,
  ) {}

  async scheduleProfileGeneration(profileId: string, delayMs = recommendationConfig.queueDelayMs): Promise<void> {
    try {
      await this.enqueueRecommendationGeneration(profileId, delayMs);
    } catch (error) {
      logger.warn({ err: error, profileId }, 'failed to enqueue recommendation generation');
    }
  }
}
