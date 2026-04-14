import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../../test-helpers.js';

seedTestEnv();

test('TmdbRefreshService has expected methods', async () => {
  const { TmdbRefreshService } = await import('./tmdb-refresh.service.js');
  const service = new TmdbRefreshService();
  assert.ok(typeof service.refreshProfileEpisodicFollow === 'function');
});

test('refreshProfileEpisodicFollow returns empty summary when no episodic follow rows exist', async () => {
  const { TmdbRefreshService } = await import('./tmdb-refresh.service.js');

  const service = new TmdbRefreshService(
    {} as never,
    { listEpisodicFollow: async () => [] } as never,
    {} as never,
  );

  const result = await service.refreshProfileEpisodicFollow({} as never, 'profile-1');
  assert.equal(result.skipped, 1);
  assert.equal(result.refreshedTitles, 0);
  assert.equal(result.failures, 0);
});

test('refreshProfileEpisodicFollow refreshes episodic follow rows', async () => {
  const { TmdbRefreshService } = await import('./tmdb-refresh.service.js');
  const episodicFollowWrites: Array<Record<string, unknown>> = [];

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
      listEpisodicFollow: async () => [{
        titleContentId: 'content-show-42',
        seriesMediaKey: 'show:tvdb:500',
        seriesMediaType: 'show',
        provider: 'tvdb',
        providerId: '500',
        reason: 'watch_activity',
        lastInteractedAt: new Date().toISOString(),
        nextEpisodeAirDate: null,
        metadataRefreshedAt: null,
        payload: { source: 'test' },
        showTmdbId: 42,
      }],
      getEpisodicFollowByContentId: async () => ({
        titleContentId: 'content-show-42',
        seriesMediaKey: 'show:tvdb:500',
        seriesMediaType: 'show',
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
      syncEpisodicFollowState: async (_client: unknown, input: Record<string, unknown>) => {
        episodicFollowWrites.push(input);
      },
    } as never,
  );

  const result = await service.refreshProfileEpisodicFollow({} as never, 'profile-1');
  assert.equal(result.refreshedTrackedShows, 1);
  assert.equal(result.refreshedTitles, 1);
  assert.equal(result.refreshedSeasons, 1);
  assert.equal(episodicFollowWrites.length, 1);
  assert.equal(episodicFollowWrites[0]?.titleContentId, 'content-show-42');
  assert.equal(episodicFollowWrites[0]?.titleMediaKey, 'show:tvdb:500');
  assert.equal((episodicFollowWrites[0]?.seriesIdentity as { mediaKey?: string } | undefined)?.mediaKey, 'show:tvdb:500');
  assert.deepEqual(episodicFollowWrites[0]?.payload, { source: 'test' });
});
