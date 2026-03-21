import { logger } from '../../config/logger.js';
import type { ProjectionRefreshJob } from '../../lib/queue.js';

export async function runRebuildProfileProjectionsJob(job: ProjectionRefreshJob): Promise<void> {
  logger.info({ job }, 'rebuild profile projections placeholder');
}
