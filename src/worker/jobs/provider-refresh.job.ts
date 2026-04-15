import { logger } from '../../config/logger.js';
import type { ProjectionRefreshJob } from '../../lib/queue.js';
import { enqueueProviderRefresh } from '../../lib/queue.js';
import { ProviderTokenRefreshService } from '../../modules/integrations/provider-token-refresh.service.js';

export async function runProviderRefreshJob(job: ProjectionRefreshJob): Promise<void> {
  if (!job.provider) {
    throw new Error('provider-refresh job missing provider');
  }

  const refreshService = new ProviderTokenRefreshService();
  const refreshed = await refreshService.refreshProviderSession(job.profileId, job.provider as 'trakt' | 'simkl');
  if (refreshed?.providerSession) {
    const delayMs = refreshService.getRecommendedDelayMs(refreshed.providerSession);
    if (delayMs !== null) {
      await enqueueProviderRefresh(refreshed.providerSession.profileId, refreshed.providerSession.provider, delayMs);
    }
  }

  logger.info({ job, refreshed: refreshed?.refreshed ?? false }, 'provider refresh job processed');
}
