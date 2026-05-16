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
      id: 'show:tmdb:1396',
      mediaKey: 'show:tmdb:1396',
      type: 'Episode',
      name: 'Breaking Bad',
      originalTitle: null,
      overview: null,
      tagline: null,
      productionYear: 2008,
      premiereDate: '2008-01-27',
      communityRating: 9.5,
      officialRating: null,
      certification: null,
      genres: [],
      runTimeSeconds: 2700,
      status: null,
      providerIds: { tmdb: null, imdb: null, tvdb: null },
      imageTags: {
        primary: { small: 'poster', medium: 'poster', large: 'poster' },
        backdrop: [{ small: 'backdrop', medium: 'backdrop', large: 'backdrop' }],
        logo: null,
        thumb: null,
        screenshot: [],
      },
      parentImageTags: null,
      seriesId: '1396',
      seriesName: null,
      seasonId: null,
      seasonName: null,
      parentIndexNumber: 1,
      indexNumber: 2,
      absoluteIndexNumber: null,
      episodeTitle: 'Cat\'s in the Bag...',
      airDate: '2008-01-27',
      trailerUrl: null,
      trailerThumbnailUrl: null,
      posterColor: null,
      backdropColor: null,
      userData: null,
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
      mediaType: 'Episode',
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
