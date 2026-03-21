import { Worker } from 'bullmq';
import { logger } from '../config/logger.js';
import { bullConnection, projectionQueueName } from '../lib/queue.js';
import { runMetadataRefreshJob } from './jobs/metadata-refresh.job.js';
import { runRebuildProfileProjectionsJob } from './jobs/rebuild-profile-projections.job.js';
import { runRefreshCalendarCacheJob } from './jobs/refresh-calendar-cache.job.js';
import { runRefreshHomeCacheJob } from './jobs/refresh-home-cache.job.js';

export function startWorker(): Worker {
  return new Worker(
    projectionQueueName,
    async (job) => {
      const payload = job.data as { profileId: string; reason: string };
      switch (payload.reason) {
        case 'refresh-home-cache':
          await runRefreshHomeCacheJob(payload);
          return;
        case 'refresh-calendar-cache':
          await runRefreshCalendarCacheJob(payload);
          return;
        case 'metadata-refresh':
          await runMetadataRefreshJob(payload);
          return;
        default:
          await runRebuildProfileProjectionsJob(payload);
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
