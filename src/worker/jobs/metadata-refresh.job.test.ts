import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

test('runMetadataRefreshJob invalidates title-page cache and calendar cache', async (t) => {
  const { redis } = await import('../../lib/redis.js');
  const { calendarCacheKey } = await import('../../modules/cache/cache-keys.js');
  const { MetadataRefreshService } = await import('../../modules/metadata/metadata-refresh.service.js');
  const { MetadataTitleCacheService } = await import('../../modules/metadata/metadata-title-cache.service.js');
  const db = await import('../../lib/db.js');
  const { runMetadataRefreshJob } = await import('./metadata-refresh.job.js');

  const originals = {
    withDbClient: db.withDbClient,
    redisDel: redis.del.bind(redis),
    refreshMediaKey: MetadataRefreshService.prototype.refreshMediaKey,
    refreshProfileEpisodicFollow: MetadataRefreshService.prototype.refreshProfileEpisodicFollow,
    invalidateByMediaKey: MetadataTitleCacheService.prototype.invalidateByMediaKey,
  };

  const invalidatedMediaKeys: string[] = [];
  const deletedKeys: string[][] = [];

  (db as { withDbClient: typeof db.withDbClient }).withDbClient = (async (work: (client: never) => Promise<unknown>) => work({} as never)) as typeof db.withDbClient;
  redis.del = (async (...keys: string[]) => {
    deletedKeys.push(keys);
    return keys.length;
  }) as typeof redis.del;
  MetadataRefreshService.prototype.refreshMediaKey = async function () {
    return {
      summary: {
        refreshedTitles: 1,
        refreshedSeasons: 0,
        refreshedTrackedShows: 0,
        skipped: 0,
        failures: 0,
      },
      mediaKeys: ['show:tvdb:100'],
    };
  };
  MetadataRefreshService.prototype.refreshProfileEpisodicFollow = async function () {
    return {
      summary: {
        refreshedTitles: 1,
        refreshedSeasons: 0,
        refreshedTrackedShows: 1,
        skipped: 0,
        failures: 0,
      },
      mediaKeys: ['show:tvdb:100'],
    };
  };
  MetadataTitleCacheService.prototype.invalidateByMediaKey = async function (mediaKey: string) {
    invalidatedMediaKeys.push(mediaKey);
  };

  t.after(() => {
    (db as { withDbClient: typeof db.withDbClient }).withDbClient = originals.withDbClient;
    redis.del = originals.redisDel;
    MetadataRefreshService.prototype.refreshMediaKey = originals.refreshMediaKey;
    MetadataRefreshService.prototype.refreshProfileEpisodicFollow = originals.refreshProfileEpisodicFollow;
    MetadataTitleCacheService.prototype.invalidateByMediaKey = originals.invalidateByMediaKey;
  });

  await runMetadataRefreshJob({ profileId: 'profile-1', reason: 'metadata-refresh', mediaKey: 'show:tvdb:100' });

  assert.deepEqual(invalidatedMediaKeys, ['show:tvdb:100']);
  assert.deepEqual(deletedKeys, [[calendarCacheKey('profile-1')]]);
});
