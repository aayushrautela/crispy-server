import { logger } from '../../config/logger.js';
import type { ProjectionRefreshJob } from '../../lib/queue.js';
import { enqueueProviderRefresh } from '../../lib/queue.js';
import { ProviderTokenRefreshService } from '../../modules/imports/provider-token-refresh.service.js';

export async function runProviderRefreshJob(job: ProjectionRefreshJob): Promise<void> {
  if (!job.connectionId) {
    throw new Error('provider-refresh job missing connectionId');
  }

  const refreshService = new ProviderTokenRefreshService();
  const refreshed = await refreshService.refreshConnectionById(job.connectionId);
  if (refreshed?.connection) {
    const delayMs = refreshService.getRecommendedDelayMs(refreshed.connection);
    if (delayMs !== null) {
      await enqueueProviderRefresh(refreshed.connection.profileId, refreshed.connection.id, delayMs);
    }
  }

  logger.info({ job, refreshed: refreshed?.refreshed ?? false }, 'provider refresh job processed');
}
