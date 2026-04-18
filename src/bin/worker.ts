import { RecommendationGenerationOrchestratorService } from '../modules/recommendations/recommendation-generation-orchestrator.service.js';
import { logger } from '../config/logger.js';
import { registerWorkerLogging, startRecommendationWorker, startWorker } from '../worker/index.js';

const worker = startWorker();
registerWorkerLogging(worker);
const recommendationWorker = startRecommendationWorker();
registerWorkerLogging(recommendationWorker);

const recommendationGenerationOrchestrator = new RecommendationGenerationOrchestratorService();

void recommendationGenerationOrchestrator.enqueueRecoveryJobs().catch((err) => {
  logger.error({ err }, 'failed to enqueue recommendation generation recovery jobs on startup');
});

logger.info('worker started');

process.on('SIGTERM', async () => {
  await recommendationWorker.close();
  await worker.close();
  process.exit(0);
});
