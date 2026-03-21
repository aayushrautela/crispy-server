import { logger } from '../../config/logger.js';
import type { ProjectionRefreshJob } from '../../lib/queue.js';

export async function runMetadataRefreshJob(job: ProjectionRefreshJob): Promise<void> {
  logger.info({ job }, 'metadata refresh placeholder');
}
