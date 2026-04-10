import { logger } from '../../config/logger.js';
import { withDbClient } from '../../lib/db.js';
import { redis } from '../../lib/redis.js';
import type { ProjectionRefreshJob } from '../../lib/queue.js';
import { MetadataRefreshService } from '../../modules/metadata/metadata-refresh.service.js';
import { MetadataTitleCacheService } from '../../modules/metadata/metadata-title-cache.service.js';
import { calendarCacheKey } from '../../modules/cache/cache-keys.js';

export async function runMetadataRefreshJob(job: ProjectionRefreshJob): Promise<void> {
  const metadataRefreshService = new MetadataRefreshService();
  const metadataTitleCacheService = new MetadataTitleCacheService();

  const result = await withDbClient(async (client) => {
    if (job.mediaKey) {
      return metadataRefreshService.refreshMediaKey(client, job.profileId, job.mediaKey);
    }
    return metadataRefreshService.refreshProfileEpisodicFollow(client, job.profileId);
  });

  for (const mediaKey of result.mediaKeys) {
    await metadataTitleCacheService.invalidateByMediaKey(mediaKey);
  }
  await redis.del(calendarCacheKey(job.profileId));
  logger.info({ job, summary: result.summary, mediaKeys: result.mediaKeys }, 'metadata refresh completed');
}
