import { logger } from '../../config/logger.js';
import type { ProjectionRefreshJob } from '../../lib/queue.js';
import { enqueueProviderRefresh } from '../../lib/queue.js';
import { ProviderTokenRefreshService } from '../../modules/integrations/provider-token-refresh.service.js';

export async function runProviderRefreshJob(job: ProjectionRefreshJob): Promise<void> {
  if (!job.providerAccountId) {
    throw new Error('provider-refresh job missing providerAccountId');
  }

  const refreshService = new ProviderTokenRefreshService();
  const refreshed = await refreshService.refreshProviderAccountById(job.providerAccountId);
  if (refreshed?.providerAccount) {
    const delayMs = refreshService.getRecommendedDelayMs(refreshed.providerAccount);
    if (delayMs !== null) {
      await enqueueProviderRefresh(refreshed.providerAccount.profileId, refreshed.providerAccount.id, delayMs);
    }
  }

  logger.info({ job, refreshed: refreshed?.refreshed ?? false }, 'provider refresh job processed');
}
