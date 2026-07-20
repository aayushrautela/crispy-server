import { Worker } from 'bullmq';
import { logger } from '../config/logger.js';
import { bullConnection, homeQueueName, projectionQueueName, type TmdbCachePurgeExpiredJob, type TmdbCacheRefreshJob, type TmdbCacheWarmSeasonBatchJob, type TmdbCacheWarmTitleBatchJob } from '../lib/queue.js';
import { runProviderImportJob } from './jobs/provider-import.job.js';
import { runProviderRefreshJob } from './jobs/provider-refresh.job.js';
import { runRefreshCalendarCacheJob } from './jobs/refresh-calendar-cache.job.js';
import { runHomeSeedJob } from './jobs/home-seed.job.js';
import {
  runTmdbCachePurgeExpiredJob,
  runTmdbCacheRefreshJob,
  runTmdbSeasonWarmBatchJob,
  runTmdbTitleWarmBatchJob,
} from './jobs/tmdb-cache.job.js';

export function startWorker(): Worker {
  const projectionWorker = new Worker(
    projectionQueueName,
    async (job) => {
      const payload = job.data as {
        profileId: string;
        reason: string;
        importJobId?: string;
        provider?: string;
      } & Record<string, unknown>;
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
        case 'tmdb-cache-refresh':
          await runTmdbCacheRefreshJob(payload as unknown as TmdbCacheRefreshJob);
          return;
        case 'tmdb-cache-warm-title-batch':
          await runTmdbTitleWarmBatchJob(payload as unknown as TmdbCacheWarmTitleBatchJob);
          return;
        case 'tmdb-cache-warm-season-batch':
          await runTmdbSeasonWarmBatchJob(payload as unknown as TmdbCacheWarmSeasonBatchJob);
          return;
        case 'tmdb-cache-purge-expired':
          await runTmdbCachePurgeExpiredJob(payload as unknown as TmdbCachePurgeExpiredJob);
          return;
        default:
          throw new Error(`Unsupported worker job reason: ${payload.reason}`);
      }
    },
    { connection: bullConnection },
  );

  const homeWorker = new Worker(
    homeQueueName,
    async (job) => {
      await runHomeSeedJob(job.data as Parameters<typeof runHomeSeedJob>[0]);
    },
    { connection: bullConnection },
  );

  homeWorker.on('failed', (job, error) => {
    logger.error({ jobId: job?.id, err: error }, 'home worker job failed');
  });

  return projectionWorker;
}

export function registerWorkerLogging(worker: Worker): void {
  worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'worker job completed');
  });
  worker.on('failed', (job, error) => {
    logger.error({ jobId: job?.id, err: error }, 'worker job failed');
  });
}
