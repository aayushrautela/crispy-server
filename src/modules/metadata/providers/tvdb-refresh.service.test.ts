import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../../test-helpers.js';

seedTestEnv();

test('TvdbRefreshService refreshes cached bundle and episodic follow state', async () => {
  const { TvdbRefreshService } = await import('./tvdb-refresh.service.js');
  const writes: Array<Record<string, unknown>> = [];

  const service = new TvdbRefreshService(
    {
      refreshTitleBundle: async () => ({
        title: {} as never,
        seasons: [],
        episodes: [{ airDate: '2099-01-01', seasonNumber: 1, episodeNumber: 1 } as never],
      }),
    } as never,
    {
      getEpisodicFollowByMediaKey: async () => ({
        titleContentId: 'content-show-1',
        seriesMediaKey: 'show:tvdb:1',
        payload: { source: 'test' },
      }),
      getEpisodicFollowByContentId: async () => null,
    } as never,
    {
      syncEpisodicFollowState: async (_client: unknown, input: Record<string, unknown>) => { writes.push(input); },
    } as never,
  );

  const result = await service.refreshIdentity({} as never, 'profile-1', {
    mediaKey: 'show:tvdb:1',
    mediaType: 'show',
    provider: 'tvdb',
    providerId: '1',
    tmdbId: null,
    showTmdbId: null,
    seasonNumber: null,
    episodeNumber: null,
    absoluteEpisodeNumber: null,
  });

  assert.equal(result.refreshedTitles, 1);
  assert.equal(result.refreshedTrackedShows, 1);
  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.titleContentId, 'content-show-1');
  assert.equal(writes[0]?.titleMediaKey, 'show:tvdb:1');
  assert.equal((writes[0]?.seriesIdentity as { mediaKey?: string } | undefined)?.mediaKey, 'show:tvdb:1');
  assert.deepEqual(writes[0]?.payload, { source: 'test' });
});
