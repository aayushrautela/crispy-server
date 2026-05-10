import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { withDbClient } from '../lib/db.js';
import { buildApp } from '../http/app.js';
import { createAdminBulkJobsWorkerRuntime } from '../modules/admin-bulk-jobs/worker-runtime.js';
import { imdbRatingsService } from '../modules/metadata/enrichment/imdb-ratings.service.js';

const app = await buildApp();
const adminBulkJobsWorkerRuntime = env.adminBulkJobsWorkerMode === 'inline'
  ? createAdminBulkJobsWorkerRuntime()
  : null;

if (adminBulkJobsWorkerRuntime) {
  app.addHook('onReady', async () => {
    adminBulkJobsWorkerRuntime.start();
    logger.info('admin bulk jobs inline worker started');
  });

  app.addHook('onClose', async () => {
    await adminBulkJobsWorkerRuntime.stop();
  });
}

withDbClient(async (client) => {
  await imdbRatingsService.initialize(client);
  imdbRatingsService.startPeriodicUpdate(() => withDbClient(async (c) => c));
}).catch((err) => {
  logger.error({ err }, 'failed to initialize imdb ratings');
});

try {
  await app.listen({
    host: env.serverHost,
    port: env.serverPort,
  });
  logger.info({ host: env.serverHost, port: env.serverPort }, 'api listening');
} catch (error) {
  logger.error({ err: error }, 'failed to start api');
  process.exit(1);
}
