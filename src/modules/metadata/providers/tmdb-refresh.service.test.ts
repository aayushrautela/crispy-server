import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../../test-helpers.js';

seedTestEnv();

test('TmdbRefreshService has expected methods', async () => {
  const { TmdbRefreshService } = await import('./tmdb-refresh.service.js');
  const service = new TmdbRefreshService();
  assert.ok(typeof service.refreshProfileTrackedSeries === 'function');
});

test('refreshProfileTrackedSeries returns empty summary when no tracked series', async () => {
  const { TmdbRefreshService } = await import('./tmdb-refresh.service.js');

  const service = new TmdbRefreshService(
    {} as never,
    { listTrackedTitles: async () => [] } as never,
    {} as never,
  );

  const result = await service.refreshProfileTrackedSeries({} as never, 'profile-1');
  assert.equal(result.skipped, 1);
  assert.equal(result.refreshedTitles, 0);
  assert.equal(result.failures, 0);
});

test('refreshProfileTrackedSeries refreshes tracked shows', async () => {
  const { TmdbRefreshService } = await import('./tmdb-refresh.service.js');
  const trackedStateWrites: Array<Record<string, unknown>> = [];

  const service = new TmdbRefreshService(
    {
      refreshTitle: async () => ({
        mediaType: 'tv', tmdbId: 42, name: 'Test Show', originalName: 'Test Show',
        overview: null, releaseDate: null, firstAirDate: null, status: null,
        posterPath: null, backdropPath: null, runtime: null, episodeRunTime: [],
        numberOfSeasons: 1, numberOfEpisodes: 10, externalIds: {}, raw: {},
        fetchedAt: '', expiresAt: '',
      }),
      refreshSeason: async () => {},
    } as never,
    {
      listTrackedTitles: async () => [{
        titleContentId: 'content-show-42',
        trackedMediaKey: 'show:tvdb:500',
        trackedMediaType: 'show',
        provider: 'tvdb',
        providerId: '500',
        reason: 'watch_activity',
        lastInteractedAt: new Date().toISOString(),
        nextEpisodeAirDate: null,
        metadataRefreshedAt: null,
        payload: { source: 'test' },
        showTmdbId: 42,
      }],
      getTrackedTitleByContentId: async () => ({
        titleContentId: 'content-show-42',
        trackedMediaKey: 'show:tvdb:500',
        trackedMediaType: 'show',
        provider: 'tvdb',
        providerId: '500',
        reason: 'watch_activity',
        lastInteractedAt: new Date().toISOString(),
        nextEpisodeAirDate: null,
        metadataRefreshedAt: null,
        payload: { source: 'test' },
        showTmdbId: 42,
      }),
    } as never,
    {
      upsertTrackedTitleState: async (_client: unknown, input: Record<string, unknown>) => {
        trackedStateWrites.push(input);
      },
    } as never,
  );

  const result = await service.refreshProfileTrackedSeries({} as never, 'profile-1');
  assert.equal(result.refreshedTrackedShows, 1);
  assert.equal(result.refreshedTitles, 1);
  assert.equal(result.refreshedSeasons, 1);
  assert.equal(trackedStateWrites.length, 1);
  assert.equal(trackedStateWrites[0]?.titleContentId, 'content-show-42');
  assert.equal(trackedStateWrites[0]?.titleMediaKey, 'show:tvdb:500');
  assert.deepEqual(trackedStateWrites[0]?.payload, { source: 'test' });
});
