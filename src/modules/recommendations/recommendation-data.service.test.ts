import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

const { RecommendationDataService } = await import('./recommendation-data.service.js');
const { db } = await import('../../lib/db.js');

test('getWatchHistoryForAccount falls back to synthesized regular cards on cache miss', async (t) => {
  const originalConnect = db.connect;
  (db as { connect: typeof db.connect }).connect = async () => ({
    release: () => {},
  }) as never;
  t.after(() => {
    (db as { connect: typeof db.connect }).connect = originalConnect;
  });

  const service = new RecommendationDataService(
    {
      assertOwnedProfile: async () => ({ id: 'profile-1' }),
    } as never,
    {} as never,
    {} as never,
    {
      listWatchHistory: async () => [
        {
          mediaKey: 'show:tvdb:100',
          title: 'Example Show',
          subtitle: 'Drama',
          posterUrl: 'https://img.test/poster.jpg',
          detailsReleaseYear: 2024,
          detailsRating: 8.2,
          watchedAt: '2024-01-10T00:00:00.000Z',
          payload: { source: 'history' },
        },
      ],
    } as never,
    {
      listRegularCards: async () => new Map(),
    } as never,
  );

  const result = await service.getWatchHistoryForAccount('user-1', 'profile-1', 10);

  assert.equal(result.length, 1);
  assert.deepEqual(result[0], {
    media: {
      mediaType: 'show',
      provider: 'tvdb',
      providerId: '100',
      title: 'Example Show',
      posterUrl: 'https://img.test/poster.jpg',
      releaseYear: 2024,
      rating: 8.2,
      genre: null,
      subtitle: 'Drama',
    },
    watchedAt: '2024-01-10T00:00:00.000Z',
    payload: { source: 'history' },
  });
});

test('getRatingsForAccount falls back to synthesized regular cards on cache miss', async (t) => {
  const originalConnect = db.connect;
  (db as { connect: typeof db.connect }).connect = async () => ({
    release: () => {},
  }) as never;
  t.after(() => {
    (db as { connect: typeof db.connect }).connect = originalConnect;
  });

  const service = new RecommendationDataService(
    {
      assertOwnedProfile: async () => ({ id: 'profile-1' }),
    } as never,
    {} as never,
    {} as never,
    {
      listRatings: async () => [
        {
          mediaKey: 'anime:kitsu:200',
          title: 'Example Anime',
          subtitle: null,
          posterUrl: 'https://img.test/anime.jpg',
          releaseYear: 2020,
          titleRating: 9.1,
          rating: 10,
          ratedAt: '2024-01-12T00:00:00.000Z',
          payload: { source: 'rating' },
        },
      ],
    } as never,
    {
      listRegularCards: async () => new Map(),
    } as never,
  );

  const result = await service.getRatingsForAccount('user-1', 'profile-1', 10);

  assert.equal(result.length, 1);
  assert.deepEqual(result[0], {
    media: {
      mediaType: 'anime',
      provider: 'kitsu',
      providerId: '200',
      title: 'Example Anime',
      posterUrl: 'https://img.test/anime.jpg',
      releaseYear: 2020,
      rating: 9.1,
      genre: null,
      subtitle: null,
    },
    rating: {
      value: 10,
      ratedAt: '2024-01-12T00:00:00.000Z',
    },
    payload: { source: 'rating' },
  });
});
