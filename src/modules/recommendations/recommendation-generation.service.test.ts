import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';
import type { ProfileInputContinueWatchingItem } from './profile-input-signal.types.js';

seedTestEnv();

const ITEM_ID = '00000000000000000000000000001396';
const SERIES_ITEM_ID = '00000000000000000000000000001397';

const { mapContinueWatchingItem } = await import('./recommendation-generation.service.js');

test('mapContinueWatchingItem maps continue-watching into provider-ref machine DTOs only', () => {
  const item: ProfileInputContinueWatchingItem = {
    id: 'cw_1',
    Item: {
      Id: ITEM_ID,
      Type: 'Series',
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
      ProviderIds: { Tmdb: '1396', Imdb: 'tt0903747', Tvdb: '81189' },
      ImageTags: {
        Primary: { small: 'poster', medium: 'poster', large: 'poster' },
        Backdrop: [{ small: 'backdrop', medium: 'backdrop', large: 'backdrop' }],
        Logo: null,
        Thumb: null,
        Screenshot: [],
      },
      ParentImageTags: null,
      SeriesId: SERIES_ITEM_ID,
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
    item: {
      type: 'tv',
      providerRefs: [
        { provider: 'tmdb', providerId: '1396' },
        { provider: 'tvdb', providerId: '81189' },
        { provider: 'imdb', providerId: 'tt0903747' },
      ],
    },
    progressPercent: 14.5,
    updatedAt: new Date('2026-03-01T18:00:00.000Z'),
  });
  assert.equal(JSON.stringify(mapped).includes(ITEM_ID), false);
  assert.equal(JSON.stringify(mapped).includes('Breaking Bad'), false);
  assert.equal(JSON.stringify(mapped).includes('poster'), false);
});
