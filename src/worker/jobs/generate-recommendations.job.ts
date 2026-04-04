import { logger } from '../../config/logger.js';
import { RecommendationGenerationOrchestratorService } from '../../modules/recommendations/recommendation-generation-orchestrator.service.js';

export async function runGenerateRecommendationsJob(payload: { profileId: string }): Promise<void> {
  const service = new RecommendationGenerationOrchestratorService();
  const result = await service.ensureGeneration(payload.profileId);
  logger.info({
    profileId: payload.profileId,
    localJobId: result.jobId,
    status: result.status,
    mode: result.mode,
  }, 'recommendation generation job processed');
}
