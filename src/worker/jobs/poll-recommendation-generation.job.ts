import { logger } from '../../config/logger.js';
import { RecommendationGenerationOrchestratorService } from '../../modules/recommendations/recommendation-generation-orchestrator.service.js';

export async function runPollRecommendationGenerationJob(payload: { recommendationJobId?: string }): Promise<void> {
  if (!payload.recommendationJobId) {
    throw new Error('poll-recommendation-generation job missing recommendationJobId');
  }

  const service = new RecommendationGenerationOrchestratorService();
  const result = await service.pollJob(payload.recommendationJobId);
  logger.info({
    localJobId: payload.recommendationJobId,
    status: result.status,
  }, 'recommendation generation poll job processed');
}
