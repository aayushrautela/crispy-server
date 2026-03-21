import { logger } from '../../config/logger.js';
import { redis } from '../../lib/redis.js';
import type { ProjectionRefreshJob } from '../../lib/queue.js';

export async function runRefreshHomeCacheJob(job: ProjectionRefreshJob): Promise<void> {
  await redis.del(`home:${job.profileId}`);
  logger.info({ job }, 'refreshed home cache');
}
