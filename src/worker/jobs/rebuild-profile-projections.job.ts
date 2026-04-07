import { logger } from '../../config/logger.js';
import { withTransaction } from '../../lib/db.js';
import type { ProjectionRefreshJob } from '../../lib/queue.js';
import { redis } from '../../lib/redis.js';
import { WatchV2ProjectionRebuildService } from '../../modules/watch-v2/watch-v2-projection-rebuild.service.js';
import { calendarCacheKey } from '../../modules/cache/cache-keys.js';

export async function runRebuildProfileProjectionsJob(job: ProjectionRefreshJob): Promise<void> {
  const rebuildService = new WatchV2ProjectionRebuildService();

  const summary = await withTransaction(async (client) => {
    return rebuildService.rebuildProfile(client, job.profileId);
  });

  await redis.del(calendarCacheKey(job.profileId));

  logger.info({ job, summary }, 'rebuild profile projections completed');
}
