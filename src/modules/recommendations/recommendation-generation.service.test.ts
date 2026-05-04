import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';
import type { ContinueWatchingProductItem } from '../watch/watch-derived-item.types.js';

seedTestEnv();

const { mapContinueWatchingItem } = await import('./recommendation-generation.service.js');

test('mapContinueWatchingItem maps continue-watching items into explicit worker DTOs', () => {
  const item: ContinueWatchingProductItem = {
    id: 'cw_1',
    media: {
      mediaType: 'show',
      mediaKey: 'show:tmdb:1396',
      title: 'Breaking Bad',
      posterUrl: 'poster',
      backdropUrl: 'backdrop',
      releaseYear: 2008,
      rating: 9.5,
      genre: null,
      seasonNumber: 1,
      episodeNumber: 2,
      episodeTitle: 'Cat\'s in the Bag...',
      airDate: '2008-01-27T00:00:00.000Z',
      runtimeMinutes: 45,
    },
    progress: {
      positionSeconds: null,
      durationSeconds: null,
      progressPercent: 14.5,
      lastPlayedAt: '2026-03-01T18:00:00.000Z',
    },
    lastActivityAt: '2026-03-01T18:00:00.000Z',
    origins: ['canonical_watch'],
    dismissible: true,
  };

  const mapped = mapContinueWatchingItem(item);

  assert.deepEqual(mapped, {
    id: 'cw_1',
    media: {
      mediaType: 'show',
      mediaKey: 'show:tmdb:1396',
      title: 'Breaking Bad',
    },
    progress: {
      positionSeconds: null,
      durationSeconds: null,
      progressPercent: 14.5,
      lastPlayedAt: '2026-03-01T18:00:00.000Z',
    },
    lastActivityAt: '2026-03-01T18:00:00.000Z',
    payload: {},
  });
});
