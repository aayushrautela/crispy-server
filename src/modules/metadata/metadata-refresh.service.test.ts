import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';
import { inferMediaIdentity } from '../identity/media-key.js';

seedTestEnv();

test('refreshMediaKey returns mediaKeys for movie identities', async () => {
  const { MetadataRefreshService } = await import('./metadata-refresh.service.js');

  const service = new MetadataRefreshService(
    {
      refreshIdentity: async () => ({
        refreshedTitles: 1,
        refreshedSeasons: 0,
        refreshedTrackedShows: 0,
        skipped: 0,
        failures: 0,
      }),
      refreshShow: async () => ({
        refreshedTitles: 0,
        refreshedSeasons: 0,
        refreshedTrackedShows: 0,
        skipped: 0,
        failures: 0,
      }),
    } as never,
    {} as never,
    {} as never,
    {} as never,
  );

  const result = await service.refreshIdentity(
    {} as never,
    'profile-1',
    inferMediaIdentity({ mediaType: 'movie', tmdbId: 55 }),
  );

  assert.deepEqual(result, {
    summary: {
      refreshedTitles: 1,
      refreshedSeasons: 0,
      refreshedTrackedShows: 0,
      skipped: 0,
      failures: 0,
    },
    mediaKeys: ['movie:tmdb:55'],
  });
});

test('refreshProfileEpisodicFollow merges and dedupes mediaKeys', async () => {
  const { MetadataRefreshService } = await import('./metadata-refresh.service.js');

  const service = new MetadataRefreshService(
    {
      refreshIdentity: async () => ({
        refreshedTitles: 0,
        refreshedSeasons: 0,
        refreshedTrackedShows: 0,
        skipped: 0,
        failures: 0,
      }),
      refreshShow: async (_client: unknown, _profileId: string, _showTmdbId: number, _seasonNumber: number | null, episodicFollow?: { seriesMediaKey: string }) => ({
        refreshedTitles: 1,
        refreshedSeasons: 2,
        refreshedTrackedShows: episodicFollow ? 1 : 0,
        skipped: 0,
        failures: 0,
      }),
    } as never,
    {
      listEpisodicFollow: async () => [
        {
          showTmdbId: 100,
          titleContentId: 'content-1',
          seriesMediaKey: 'show:tvdb:100',
          payload: {},
        },
        {
          showTmdbId: 100,
          titleContentId: 'content-2',
          seriesMediaKey: 'show:tvdb:100',
          payload: {},
        },
      ],
    } as never,
    {} as never,
    {} as never,
  );

  const result = await service.refreshProfileEpisodicFollow({} as never, 'profile-1');

  assert.deepEqual(result, {
    summary: {
      refreshedTitles: 2,
      refreshedSeasons: 4,
      refreshedTrackedShows: 2,
      skipped: 0,
      failures: 0,
    },
    mediaKeys: ['show:tvdb:100'],
  });
});
