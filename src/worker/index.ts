import { Worker } from 'bullmq';
import { logger } from '../config/logger.js';
import { bullConnection, projectionQueueName, recommendationQueueName } from '../lib/queue.js';
import { RecommendationGenerationOrchestratorService } from '../modules/recommendations/recommendation-generation-orchestrator.service.js';
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
        provider?: string;
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

export function startRecommendationWorker(): Worker {
  const orchestrator = new RecommendationGenerationOrchestratorService();

  return new Worker(
    recommendationQueueName,
    async (job) => {
      const payload = job.data as {
        jobId: string;
        reason: 'recommendation-submit' | 'recommendation-sync';
      };

      if (payload.reason === 'recommendation-submit') {
        await orchestrator.submitQueuedJob(payload.jobId);
        return;
      }

      await orchestrator.syncQueuedJob(payload.jobId);
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
