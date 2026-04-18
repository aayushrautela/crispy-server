import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

const { WatchExportService } = await import('./watch-export.service.js');

test('listEpisodicFollow returns episodic follow rows from watch query service', async () => {
  const rows = [
    {
      seriesMediaKey: 'show:tmdb:100',
      seriesMediaType: 'show',
      provider: 'tmdb',
      providerId: '100',
      reason: 'watchlist',
      lastInteractedAt: '2024-01-03T00:00:00.000Z',
      nextEpisodeAirDate: '2024-01-10',
      metadataRefreshedAt: '2024-01-04T00:00:00.000Z',
      payload: { source: 'episodic-follow' },
    },
  ];

  const service = new WatchExportService(
    {} as never,
    {
      listEpisodicFollow: async () => rows,
    } as never,
  );

  const result = await service.listEpisodicFollow({} as never, 'profile-1', 20);

  assert.deepEqual(result, rows);
});
