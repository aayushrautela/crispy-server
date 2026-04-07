import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../../test-helpers.js';

seedTestEnv();

test('KitsuRefreshService refreshes cached bundle and tracked title state', async () => {
  const { KitsuRefreshService } = await import('./kitsu-refresh.service.js');
  const writes: Array<Record<string, unknown>> = [];

  const service = new KitsuRefreshService(
    {
      refreshTitleBundle: async () => ({
        title: {} as never,
        seasons: [],
        episodes: [{ airDate: '2099-02-01', seasonNumber: 1, episodeNumber: 1 } as never],
      }),
    } as never,
    {
      getTrackedTitleByMediaKey: async () => ({
        titleContentId: 'content-anime-1',
        trackedMediaKey: 'anime:kitsu:1',
        payload: { source: 'test' },
      }),
      getTrackedTitleByContentId: async () => null,
    } as never,
    {
      upsertTrackedTitleState: async (_client: unknown, input: Record<string, unknown>) => { writes.push(input); },
    } as never,
  );

  const result = await service.refreshIdentity({} as never, 'profile-1', {
    mediaKey: 'anime:kitsu:1',
    mediaType: 'anime',
    provider: 'kitsu',
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
  assert.equal(writes[0]?.nextEpisodeAirDate, '2099-02-01');
});
