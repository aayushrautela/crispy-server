import { recommendationConfig } from '../modules/recommendations/recommendation-config.js';
import { RecommendationGenerationOrchestratorService } from '../modules/recommendations/recommendation-generation-orchestrator.service.js';
import { logger } from '../config/logger.js';
import { registerWorkerLogging, startWorker } from '../worker/index.js';

const worker = startWorker();
registerWorkerLogging(worker);

const recommendationGenerationOrchestrator = new RecommendationGenerationOrchestratorService();
let recoveryTimer: ReturnType<typeof setInterval> | null = null;
let reconciliationInFlight = false;

async function runRecommendationReconciliation(logMessage: string): Promise<void> {
  if (reconciliationInFlight) {
    logger.warn('skipping recommendation generation reconciliation while previous run is still in progress');
    return;
  }

  reconciliationInFlight = true;
  try {
    await recommendationGenerationOrchestrator.reconcileDueJobs();
  } catch (err) {
    logger.error({ err }, logMessage);
  } finally {
    reconciliationInFlight = false;
  }
}

void runRecommendationReconciliation('failed to reconcile recommendation generation jobs on startup');

recoveryTimer = setInterval(() => {
  void runRecommendationReconciliation('failed to reconcile recommendation generation jobs');
}, recommendationConfig.pollDelayMs);

logger.info({ intervalMs: recommendationConfig.pollDelayMs }, 'scheduled recommendation generation reconciliation');

logger.info('worker started');

process.on('SIGTERM', async () => {
  if (recoveryTimer) {
    clearInterval(recoveryTimer);
    recoveryTimer = null;
  }
  await worker.close();
  process.exit(0);
});
