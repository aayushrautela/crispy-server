import { logger } from '../config/logger.js';
import { registerWorkerLogging, startWorker } from '../worker/index.js';
import { startAiGenerationWorker } from '../worker/ai-generation.worker.js';

const projectionWorker = startWorker();
registerWorkerLogging(projectionWorker);

const aiWorker = startAiGenerationWorker();
registerWorkerLogging(aiWorker);

logger.info('workers started');

process.on('SIGTERM', async () => {
  await Promise.all([projectionWorker.close(), aiWorker.close()]);
  process.exit(0);
});
