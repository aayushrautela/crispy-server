import { logger } from '../../config/logger.js';
import { redis } from '../../lib/redis.js';
import type { ProjectionRefreshJob } from '../../lib/queue.js';

export async function runRefreshCalendarCacheJob(job: ProjectionRefreshJob): Promise<void> {
  await redis.del(`calendar:${job.profileId}`);
  logger.info({ job }, 'refreshed calendar cache');
}
