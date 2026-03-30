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
    { listForProfile: async () => [] } as never,
  );

  const result = await service.refreshProfileTrackedSeries({} as never, 'profile-1');
  assert.equal(result.skipped, 1);
  assert.equal(result.refreshedTitles, 0);
  assert.equal(result.failures, 0);
});

test('refreshProfileTrackedSeries refreshes tracked shows', async () => {
  const { TmdbRefreshService } = await import('./tmdb-refresh.service.js');

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
      listForProfile: async () => [{
        profileId: 'profile-1',
        trackedMediaKey: 'show:tmdb:42',
        trackedMediaType: 'show',
        provider: 'tmdb',
        providerId: '42',
        showTmdbId: 42,
        reason: 'watch_history',
        lastSourceEventId: 'event-1',
        lastInteractedAt: new Date().toISOString(),
        nextEpisodeAirDate: null,
        metadataRefreshedAt: null,
        payload: null,
      }],
      updateMetadataState: async () => {},
    } as never,
  );

  const result = await service.refreshProfileTrackedSeries({} as never, 'profile-1');
  assert.equal(result.refreshedTrackedShows, 1);
  assert.equal(result.refreshedTitles, 1);
  assert.equal(result.refreshedSeasons, 1);
});
