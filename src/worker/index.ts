import { Worker } from 'bullmq';
import { logger } from '../config/logger.js';
import { bullConnection, projectionQueueName } from '../lib/queue.js';
import { runGenerateRecommendationsJob } from './jobs/generate-recommendations.job.js';
import { runPollRecommendationGenerationJob } from './jobs/poll-recommendation-generation.job.js';
import { HeartbeatFlushService } from '../modules/watch/heartbeat-flush.service.js';
import { runMetadataRefreshJob } from './jobs/metadata-refresh.job.js';
import { runProviderImportJob } from './jobs/provider-import.job.js';
import { runProviderRefreshJob } from './jobs/provider-refresh.job.js';
import { runRebuildProfileProjectionsJob } from './jobs/rebuild-profile-projections.job.js';
import { runRefreshCalendarCacheJob } from './jobs/refresh-calendar-cache.job.js';

export function startWorker(): Worker {
  const heartbeatFlushService = new HeartbeatFlushService();

  return new Worker(
    projectionQueueName,
    async (job) => {
      const payload = job.data as {
        profileId: string;
        reason: string;
        mediaKey?: string;
        importJobId?: string;
        providerAccountId?: string;
        recommendationJobId?: string;
      };
      switch (payload.reason) {
        case 'flush-heartbeat':
          if (!payload.mediaKey) {
            throw new Error('flush-heartbeat job missing mediaKey');
          }
          await heartbeatFlushService.flush(payload.profileId, payload.mediaKey);
          return;
        case 'refresh-calendar-cache':
          await runRefreshCalendarCacheJob(payload);
          return;
        case 'metadata-refresh':
          await runMetadataRefreshJob(payload);
          return;
        case 'generate-recommendations':
          await runGenerateRecommendationsJob(payload);
          return;
        case 'poll-recommendation-generation':
          await runPollRecommendationGenerationJob(payload);
          return;
        case 'provider-import':
          await runProviderImportJob(payload);
          return;
        case 'provider-refresh':
          await runProviderRefreshJob(payload);
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
