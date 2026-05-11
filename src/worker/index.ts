import { Worker } from 'bullmq';
import { logger } from '../config/logger.js';
import { bullConnection, projectionQueueName } from '../lib/queue.js';
import { runProviderImportJob } from './jobs/provider-import.job.js';
import { runProviderRefreshJob } from './jobs/provider-refresh.job.js';
import { runRefreshCalendarCacheJob } from './jobs/refresh-calendar-cache.job.js';

export function startWorker(): Worker {
  return new Worker(
    projectionQueueName,
    async (job) => {
      const payload = job.data as {
        profileId: string;
        reason: string;
        importJobId?: string;
        provider?: string;
      };
      switch (payload.reason) {
        case 'refresh-calendar-cache':
          await runRefreshCalendarCacheJob(payload);
          return;
        case 'provider-import':
          await runProviderImportJob(payload);
          return;
        case 'provider-refresh':
          await runProviderRefreshJob(payload);
          return;
        default:
          throw new Error(`Unsupported worker job reason: ${payload.reason}`);
      }
    },
    { connection: bullConnection },
  );
}

export function registerWorkerLogging(worker: Worker): void {
  worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'worker job completed');
  });
  worker.on('failed', (job, error) => {
    logger.error({ jobId: job?.id, err: error }, 'worker job failed');
  });
}
