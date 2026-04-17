import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

test('runMetadataRefreshJob invalidates title-page cache and calendar cache', async (t) => {
  const { calendarCacheKey } = await import('../../modules/cache/cache-keys.js');
  const { runMetadataRefreshJob } = await import('./metadata-refresh.job.js');

  const invalidatedMediaKeys: string[] = [];
  const deletedKeys: string[][] = [];
  const refreshedProjections: string[] = [];

  await runMetadataRefreshJob(
    { profileId: 'profile-1', reason: 'metadata-refresh', mediaKey: 'show:tvdb:100' },
    {
      withDbClientImpl: async (work) => work({} as never),
      redisClient: {
        del: async (...keys: string[]) => {
          deletedKeys.push(keys);
          return keys.length;
        },
      },
      metadataRefreshService: {
        refreshMediaKey: async () => ({
          summary: {
            refreshedTitles: 1,
            refreshedSeasons: 0,
            refreshedTrackedShows: 0,
            skipped: 0,
            failures: 0,
          },
          mediaKeys: ['show:tvdb:100'],
        }),
        refreshProfileEpisodicFollow: async () => ({
          summary: {
            refreshedTitles: 1,
            refreshedSeasons: 0,
            refreshedTrackedShows: 1,
            skipped: 0,
            failures: 0,
          },
          mediaKeys: ['show:tvdb:100'],
        }),
      },
      metadataTitleCacheService: {
        invalidateByMediaKey: async (mediaKey: string) => {
          invalidatedMediaKeys.push(mediaKey);
        },
      },
      watchV2WriteService: {
        refreshProjectionForMediaKey: async (_client: unknown, _profileId: string, mediaKey: string) => {
          refreshedProjections.push(mediaKey);
        },
      },
      log: { info: () => {} },
    },
  );

  assert.deepEqual(refreshedProjections, ['show:tvdb:100']);
  assert.deepEqual(invalidatedMediaKeys, ['show:tvdb:100']);
  assert.deepEqual(deletedKeys, [[calendarCacheKey('profile-1')]]);
});
