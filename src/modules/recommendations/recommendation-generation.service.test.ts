import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';
import type { ContinueWatchingProductItem } from '../watch/watch-derived-item.types.js';

seedTestEnv();

const { mapContinueWatchingItem } = await import('./recommendation-generation.service.js');

test('mapContinueWatchingItem maps continue-watching items into explicit worker DTOs', () => {
  const item: ContinueWatchingProductItem = {
    id: 'cw_1',
    kind: 'continue_watching',
    mediaItem: {
      mediaKey: 'show:tmdb:1396',
      mediaType: 'episode',
      title: 'Breaking Bad',
      originalTitle: null,
      subtitle: 'S01 E02',
      overview: null,
      posterUrl: 'poster',
      backdropUrl: 'backdrop',
      logoUrl: null,
      stillUrl: null,
      releaseDate: '2008-01-27',
      releaseYear: 2008,
      rating: 9.5,
      genres: [],
      runtimeMinutes: 45,
      status: null,
      maturityRating: null,
      certification: null,
      externalIds: { tmdb: null, tvdb: null, imdb: null },
      parent: null,
      showTmdbId: 1396,
      seasonNumber: 1,
      episodeNumber: 2,
      absoluteEpisodeNumber: null,
      episodeTitle: 'Cat\'s in the Bag...',
      airDate: '2008-01-27',
    },
    context: {
      id: 'cw_1',
      progress: {
        positionSeconds: null,
        durationSeconds: null,
        progressPercent: 14.5,
        status: 'in_progress',
        lastPlayedAt: '2026-03-01T18:00:00.000Z',
      },
      lastActivityAt: '2026-03-01T18:00:00.000Z',
      origins: ['canonical_watch'],
      dismissible: true,
    },
    presentation: { preferredSize: 'wide', sectionId: null, sectionTitle: null },
    progress: {
      positionSeconds: null,
      durationSeconds: null,
      progressPercent: 14.5,
      status: 'in_progress',
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
      mediaType: 'episode',
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
