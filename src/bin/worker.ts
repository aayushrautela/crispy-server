import { logger } from '../config/logger.js';
import { registerWorkerLogging, startWorker } from '../worker/index.js';

const worker = startWorker();
registerWorkerLogging(worker);

logger.info('worker started');

process.on('SIGTERM', async () => {
  await worker.close();
  process.exit(0);
});
