import { logger } from '../../config/logger.js';
import { withDbClient } from '../../lib/db.js';
import { redis } from '../../lib/redis.js';
import type { ProjectionRefreshJob } from '../../lib/queue.js';
import { MetadataRefreshService } from '../../modules/metadata/metadata-refresh.service.js';
import { MetadataTitleCacheService } from '../../modules/metadata/metadata-title-cache.service.js';
import { WatchV2WriteService } from '../../modules/watch-v2/watch-v2-write.service.js';
import { calendarCacheKey } from '../../modules/cache/cache-keys.js';

type MetadataRefreshJobDeps = {
  withDbClientImpl?: typeof withDbClient;
  redisClient?: Pick<typeof redis, 'del'>;
  metadataRefreshService?: Pick<MetadataRefreshService, 'refreshMediaKey' | 'refreshProfileEpisodicFollow'>;
  metadataTitleCacheService?: Pick<MetadataTitleCacheService, 'invalidateByMediaKey'>;
  watchV2WriteService?: Pick<WatchV2WriteService, 'refreshProjectionForMediaKey'>;
  log?: Pick<typeof logger, 'info'>;
};

export async function runMetadataRefreshJob(job: ProjectionRefreshJob, deps: MetadataRefreshJobDeps = {}): Promise<void> {
  const metadataRefreshService = deps.metadataRefreshService ?? new MetadataRefreshService();
  const metadataTitleCacheService = deps.metadataTitleCacheService ?? new MetadataTitleCacheService();
  const watchV2WriteService = deps.watchV2WriteService ?? new WatchV2WriteService();
  const withDbClientImpl = deps.withDbClientImpl ?? withDbClient;
  const redisClient = deps.redisClient ?? redis;
  const log = deps.log ?? logger;

  const result = await withDbClientImpl(async (client) => {
    const refreshResult = job.mediaKey
      ? await metadataRefreshService.refreshMediaKey(client, job.profileId, job.mediaKey)
      : await metadataRefreshService.refreshProfileEpisodicFollow(client, job.profileId);

    for (const mediaKey of refreshResult.mediaKeys) {
      await watchV2WriteService.refreshProjectionForMediaKey(client, job.profileId, mediaKey);
    }

    return refreshResult;
  });

  for (const mediaKey of result.mediaKeys) {
    await metadataTitleCacheService.invalidateByMediaKey(mediaKey);
  }
  await redisClient.del(calendarCacheKey(job.profileId));
  log.info({ job, summary: result.summary, mediaKeys: result.mediaKeys }, 'metadata refresh completed');
}
