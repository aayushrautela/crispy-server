import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';
import type { ProfileInputContinueWatchingItem } from './profile-input-signal.types.js';

seedTestEnv();

const { mapContinueWatchingItem } = await import('./recommendation-generation.service.js');

test('mapContinueWatchingItem maps continue-watching items into explicit worker DTOs', () => {
  const item: ProfileInputContinueWatchingItem = {
    id: 'cw_1',
    Item: {
      Id: 'show:tmdb:1396',
      Type: 'Episode',
      Name: 'Breaking Bad',
      OriginalTitle: null,
      Overview: null,
      Taglines: [],
      ProductionYear: 2008,
      PremiereDate: '2008-01-27',
      CommunityRating: 9.5,
      OfficialRating: null,
      Certification: null,
      Genres: [],
      RunTimeTicks: 27_000_000_000,
      Status: null,
      ProviderIds: { Tmdb: null, Imdb: null, Tvdb: null },
      ImageTags: {
        Primary: { small: 'poster', medium: 'poster', large: 'poster' },
        Backdrop: [{ small: 'backdrop', medium: 'backdrop', large: 'backdrop' }],
        Logo: null,
        Thumb: null,
        Screenshot: [],
      },
      ParentImageTags: null,
      SeriesId: '1396',
      SeriesName: null,
      SeasonId: null,
      SeasonName: null,
      ParentIndexNumber: 1,
      IndexNumber: 2,
      AbsoluteIndexNumber: null,
      EpisodeTitle: 'Cat\'s in the Bag...',
      AirDate: '2008-01-27',
      RemoteTrailers: [],
      PosterColor: null,
      BackdropColor: null,
      UserData: null,
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
