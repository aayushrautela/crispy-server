import { withDbClient } from '../../lib/db.js';
import type { TmdbCachePurgeExpiredJob, TmdbCacheWarmSeasonBatchJob, TmdbCacheWarmTitleBatchJob, TmdbEntityRefreshJob } from '../../lib/queue.js';
import { TmdbCacheService } from '../../modules/metadata/providers/tmdb-cache.service.js';
import { TmdbIngestService } from '../../modules/metadata/providers/tmdb-ingest.service.js';
import { TmdbRepository } from '../../modules/metadata/providers/tmdb.repo.js';

const tmdbCacheService = new TmdbCacheService();
const ingest = new TmdbIngestService();
const repository = new TmdbRepository();

export async function runTmdbEntityRefreshJob(payload: TmdbEntityRefreshJob): Promise<void> {
  await withDbClient(async (client) => {
    await ingest.ingestTitle(client, payload.mediaType, payload.tmdbId);
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
    await repository.purgeExpiredEntities(client, payload.limit);
  });
}
