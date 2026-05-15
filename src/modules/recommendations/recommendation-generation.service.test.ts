import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';
import type { ProfileInputContinueWatchingItem } from './profile-input-signal.types.js';

seedTestEnv();

const { mapContinueWatchingItem } = await import('./recommendation-generation.service.js');

test('mapContinueWatchingItem maps continue-watching items into explicit worker DTOs', () => {
  const item: ProfileInputContinueWatchingItem = {
    id: 'cw_1',
    mediaItem: {
      mediaKey: 'show:tmdb:1396',
      mediaType: 'episode',
      title: 'Breaking Bad',
      originalTitle: null,
      subtitle: 'S01 E02',
      overview: null,
      images: {
        poster: { small: 'poster', medium: 'poster', large: 'poster' },
        backdrop: { small: 'backdrop', medium: 'backdrop', large: 'backdrop' },
        logo: { small: null, medium: null, large: null },
        still: { small: null, medium: null, large: null },
      },
      releaseDate: '2008-01-27',
      releaseYear: 2008,
      rating: 9.5,
      genres: [],
      runtimeMinutes: 45,
      status: null,
      maturityRating: null,
      certification: null,
      trailerUrl: null,
      trailerThumbnailUrl: null,
      posterColor: null,
      backdropColor: null,
      externalIds: { tmdb: null, tvdb: null, imdb: null },
      parent: null,
      showTmdbId: 1396,
      seasonNumber: 1,
      episodeNumber: 2,
      absoluteEpisodeNumber: null,
      episodeTitle: 'Cat\'s in the Bag...',
      airDate: '2008-01-27',
      badges: [],
    },
    progress: {
      progressPercent: 14.5,
    },
    lastActivityAt: '2026-03-01T18:00:00.000Z',
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
    },
    lastActivityAt: '2026-03-01T18:00:00.000Z',
    payload: {},
  });
});
