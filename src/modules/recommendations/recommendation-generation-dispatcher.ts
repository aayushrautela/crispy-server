import { recommendationConfig } from './recommendation-config.js';
import { RecommendationGenerationOrchestratorService } from './recommendation-generation-orchestrator.service.js';
import type { RecommendationGenerationTriggerSource } from './recommendation-generation-jobs.repo.js';

type ScheduleRecommendationGeneration = (
  profileId: string,
  params: {
    delayMs?: number;
    triggerSource?: RecommendationGenerationTriggerSource;
  },
) => Promise<{ jobId: string; status: string; created: boolean }>;

async function defaultScheduleRecommendationGeneration(
  profileId: string,
  params: {
    delayMs?: number;
    triggerSource?: RecommendationGenerationTriggerSource;
  },
): Promise<{ jobId: string; status: string; created: boolean }> {
  const orchestrator = new RecommendationGenerationOrchestratorService();
  return orchestrator.ensureGeneration(profileId, params);
}

export class RecommendationGenerationDispatcher {
  constructor(
    private readonly scheduleRecommendationGeneration: ScheduleRecommendationGeneration = defaultScheduleRecommendationGeneration,
  ) {}

  async scheduleProfileGeneration(
    profileId: string,
    delayMs = recommendationConfig.queueDelayMs,
    triggerSource: RecommendationGenerationTriggerSource = 'system',
  ): Promise<{ jobId: string; status: string; created: boolean }> {
    return this.scheduleRecommendationGeneration(profileId, {
      delayMs,
      triggerSource,
    });
  }
}
