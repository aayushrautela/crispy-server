import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { createAdminBulkJobsWorkerRuntime } from '../modules/admin-bulk-jobs/worker-runtime.js';

if (env.adminBulkJobsWorkerMode === 'off') {
  logger.info('admin bulk jobs worker disabled');
  process.exit(0);
}

const workerRuntime = createAdminBulkJobsWorkerRuntime();

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  logger.info({ signal }, 'received shutdown signal, stopping admin bulk jobs worker');
  await workerRuntime.stop();
  process.exit(0);
}

process.on('SIGTERM', () => {
  shutdown('SIGTERM').catch((err: unknown) => {
    logger.error({ err }, 'failed to stop admin bulk jobs worker');
    process.exit(1);
  });
});

process.on('SIGINT', () => {
  shutdown('SIGINT').catch((err: unknown) => {
    logger.error({ err }, 'failed to stop admin bulk jobs worker');
    process.exit(1);
  });
});

workerRuntime.start();
logger.info('admin bulk jobs worker started');
