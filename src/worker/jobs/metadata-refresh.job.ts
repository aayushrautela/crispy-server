import { logger } from '../../config/logger.js';
import { withDbClient } from '../../lib/db.js';
import { redis } from '../../lib/redis.js';
import type { ProjectionRefreshJob } from '../../lib/queue.js';
import { TmdbRefreshService } from '../../modules/metadata/tmdb-refresh.service.js';

export async function runMetadataRefreshJob(job: ProjectionRefreshJob): Promise<void> {
  const tmdbRefreshService = new TmdbRefreshService();

  const summary = await withDbClient(async (client) => {
    if (job.mediaKey) {
      return tmdbRefreshService.refreshMediaKey(client, job.profileId, job.mediaKey);
    }
    return tmdbRefreshService.refreshProfileTrackedSeries(client, job.profileId);
  });

  await redis.del(`home:${job.profileId}`, `calendar:${job.profileId}`);
  logger.info({ job, summary }, 'metadata refresh completed');
}
