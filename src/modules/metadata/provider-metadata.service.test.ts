import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

test('loadTvdbSeriesBundle falls back from default to official episodes and normalizes year seasons', async () => {
  const { ProviderMetadataService } = await import('./provider-metadata.service.js');

  const fetchCalls: string[] = [];
  const tvdbClient = {
    fetchSeriesExtended: async () => ({
      data: {
        id: 'show-1',
        name: 'Year Show',
        overview: 'A show with year seasons.',
        episodeCount: 4,
        seasons: [
          { id: 'season-2022', number: 2022, name: '2022' },
          { id: 'season-2023', number: 2023, name: '2023' },
        ],
        artworks: [],
        remoteIds: [],
      },
    }),
    fetchSeriesEpisodes: async (_seriesId: string, seasonType: string) => {
      fetchCalls.push(seasonType);
      if (seasonType === 'default') {
        return { data: [] };
      }

      return {
        data: [
          { seasonNumber: 2022, number: 1, name: 'Pilot' },
          { seasonNumber: 2022, number: 2, name: 'Second' },
          { seasonNumber: 2023, number: 1, name: 'Return' },
          { seasonNumber: 2023, number: 2, name: 'Finale' },
        ],
      };
    },
  };

  const service = new ProviderMetadataService(
    tvdbClient as never,
    {} as never,
    { ensureTitleCached: async () => null } as never,
    { resolve: async () => null } as never,
    { getRating: async () => null } as never,
  );

  const bundle = await (service as any).loadTvdbSeriesBundle('show-1', null);

  assert.deepEqual(fetchCalls, ['default', 'official']);
  assert.deepEqual(bundle.seasons.map((season: { seasonNumber: number; title: string | null }) => ({
    seasonNumber: season.seasonNumber,
    title: season.title,
  })), [
    { seasonNumber: 1, title: '2022' },
    { seasonNumber: 2, title: '2023' },
  ]);
  assert.deepEqual(bundle.episodes.map((episode: { seasonNumber: number | null; episodeNumber: number | null }) => ({
    seasonNumber: episode.seasonNumber,
    episodeNumber: episode.episodeNumber,
  })), [
    { seasonNumber: 1, episodeNumber: 1 },
    { seasonNumber: 1, episodeNumber: 2 },
    { seasonNumber: 2, episodeNumber: 1 },
    { seasonNumber: 2, episodeNumber: 2 },
  ]);
});
