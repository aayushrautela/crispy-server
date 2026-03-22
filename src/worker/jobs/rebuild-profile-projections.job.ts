import { logger } from '../../config/logger.js';
import { withTransaction } from '../../lib/db.js';
import { enqueueMetadataRefresh, type ProjectionRefreshJob } from '../../lib/queue.js';
import { redis } from '../../lib/redis.js';
import { ProjectionRebuildService } from '../../modules/watch/projection-rebuild.service.js';

export async function runRebuildProfileProjectionsJob(job: ProjectionRefreshJob): Promise<void> {
  const rebuildService = new ProjectionRebuildService();

  const summary = await withTransaction(async (client) => {
    return rebuildService.rebuildProfile(client, job.profileId);
  });

  await redis.del(`home:${job.profileId}`, `calendar:${job.profileId}`);

  if (summary.metadataRefreshRecommended) {
    await enqueueMetadataRefresh(job.profileId);
  }

  logger.info({ job, summary }, 'rebuild profile projections completed');
}
