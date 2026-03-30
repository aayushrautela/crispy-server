import { logger } from '../../config/logger.js';
import { redis } from '../../lib/redis.js';
import type { ProjectionRefreshJob } from '../../lib/queue.js';
import { homeCacheKey } from '../../modules/cache/cache-keys.js';

export async function runRefreshHomeCacheJob(job: ProjectionRefreshJob): Promise<void> {
  await redis.del(homeCacheKey(job.profileId));
  logger.info({ job }, 'refreshed home cache');
}
