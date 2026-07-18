import { Worker } from 'bullmq';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { bullConnection, getHomescreenQueue, homescreenQueueName, projectionQueueName, type TmdbCachePurgeExpiredJob, type TmdbCacheRefreshJob, type TmdbCacheWarmSeasonBatchJob, type TmdbCacheWarmTitleBatchJob } from '../lib/queue.js';
import { runProviderImportJob } from './jobs/provider-import.job.js';
import { runProviderRefreshJob } from './jobs/provider-refresh.job.js';
import { runRefreshCalendarCacheJob } from './jobs/refresh-calendar-cache.job.js';
import { runHomescreenJob } from './jobs/homescreen.job.js';
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

  const homescreenWorker = new Worker(
    homescreenQueueName,
    async (job) => {
      await runHomescreenJob(job.data as Parameters<typeof runHomescreenJob>[0]);
    },
    { connection: bullConnection },
  );

  homescreenWorker.on('failed', (job, error) => {
    logger.error({ jobId: job?.id, err: error }, 'homescreen worker job failed');
  });

  void scheduleHomescreenJobs();

  return projectionWorker;
}

export async function scheduleHomescreenJobs(): Promise<void> {
  const queue = getHomescreenQueue();
  try {
    await queue.upsertJobScheduler('homescreen-trakt-sync-all', { pattern: env.homescreenTraktSyncCron }, {
      name: 'homescreen-trakt-sync-all',
      data: { reason: 'homescreen-trakt-sync-all' },
      opts: { removeOnComplete: true, removeOnFail: 100 },
    });
    await queue.upsertJobScheduler('homescreen-default-rebuild', { pattern: env.homescreenDefaultRebuildCron }, {
      name: 'homescreen-default-rebuild',
      data: { reason: 'homescreen-default-rebuild' },
      opts: { removeOnComplete: true, removeOnFail: 100 },
    });
  } catch (error) {
    logger.error({ err: error }, 'failed to schedule homescreen crons');
  }
}

export function registerWorkerLogging(worker: Worker): void {
  worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'worker job completed');
  });
  worker.on('failed', (job, error) => {
    logger.error({ jobId: job?.id, err: error }, 'worker job failed');
  });
}
