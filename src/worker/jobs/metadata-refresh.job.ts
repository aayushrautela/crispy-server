import { logger } from '../../config/logger.js';
import { withDbClient } from '../../lib/db.js';
import { redis } from '../../lib/redis.js';
import type { ProjectionRefreshJob } from '../../lib/queue.js';
import { MetadataRefreshService } from '../../modules/metadata/metadata-refresh.service.js';
import { homeCacheKey, calendarCacheKey } from '../../modules/cache/cache-keys.js';

export async function runMetadataRefreshJob(job: ProjectionRefreshJob): Promise<void> {
  const metadataRefreshService = new MetadataRefreshService();

  const summary = await withDbClient(async (client) => {
    if (job.mediaKey) {
      return metadataRefreshService.refreshMediaKey(client, job.profileId, job.mediaKey);
    }
    return metadataRefreshService.refreshProfileTrackedSeries(client, job.profileId);
  });

  await redis.del(homeCacheKey(job.profileId), calendarCacheKey(job.profileId));
  logger.info({ job, summary }, 'metadata refresh completed');
}
