import { withDbClient } from '../../lib/db.js';
import type { TmdbCacheRefreshJob, TmdbCacheWarmSeasonBatchJob, TmdbCacheWarmTitleBatchJob, TmdbCachePurgeExpiredJob } from '../../lib/queue.js';
import { TmdbCacheService } from '../../modules/metadata/providers/tmdb-cache.service.js';
import { TmdbClient } from '../../modules/metadata/providers/tmdb.client.js';
import { TmdbRepository } from '../../modules/metadata/providers/tmdb.repo.js';
import { TmdbResponseCacheService } from '../../modules/metadata/providers/tmdb-response-cache.service.js';

const tmdbCacheService = new TmdbCacheService();
const tmdbClient = new TmdbClient();
const responseCache = new TmdbResponseCacheService();
const repository = new TmdbRepository();

export async function runTmdbCacheRefreshJob(payload: TmdbCacheRefreshJob): Promise<void> {
  await withDbClient(async (client) => {
    await responseCache.getOrFetch(
      client,
      payload.spec,
      payload.policyKey,
      () => tmdbClient.request(payload.spec.requestPath, payload.spec.requestQuery),
    );
  });
}

export async function runTmdbTitleWarmBatchJob(payload: TmdbCacheWarmTitleBatchJob): Promise<void> {
  await withDbClient(async (client) => {
    for (const tmdbId of payload.tmdbIds) {
      await tmdbCacheService.getTitle(client, payload.mediaType, tmdbId);
    }
  });
}

export async function runTmdbSeasonWarmBatchJob(payload: TmdbCacheWarmSeasonBatchJob): Promise<void> {
  await withDbClient(async (client) => {
    for (const seasonNumber of payload.seasonNumbers) {
      await tmdbCacheService.ensureSeasonCached(client, payload.showTmdbId, seasonNumber);
    }
  });
}

export async function runTmdbCachePurgeExpiredJob(payload: TmdbCachePurgeExpiredJob): Promise<void> {
  await withDbClient(async (client) => {
    await repository.purgeExpiredApiResponses(client, payload.limit);
  });
}
