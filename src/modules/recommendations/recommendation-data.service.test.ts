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
          mediaKey: 'show:tmdb:100',
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
      id: undefined,
      media: {
        mediaType: 'show',
        mediaKey: 'show:tmdb:100',
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
          mediaKey: 'show:tmdb:200',
          title: 'Example Show',
          subtitle: null,
          posterUrl: 'https://img.test/show.jpg',
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
      id: undefined,
      media: {
        mediaType: 'show',
        mediaKey: 'show:tmdb:200',
        title: 'Example Show',
        posterUrl: 'https://img.test/show.jpg',
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

test('getEpisodicFollowForAccount returns canonical next-episode fields', async (t) => {
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
    {
      buildCardView: async () => ({
        mediaType: 'show',
        mediaKey: 'show:tmdb:100',
        provider: 'tmdb',
        providerId: '100',
        title: 'Example Show',
        posterUrl: 'https://img.test/poster.jpg',
        releaseYear: 2024,
        rating: 8.2,
        genre: null,
        subtitle: null,
      }),
    } as never,
    {
      listEpisodicFollow: async () => [
        {
          seriesMediaKey: 'show:tmdb:100',
          seriesMediaType: 'show',
          provider: 'tmdb',
          providerId: '100',
          reason: 'watchlist',
          lastInteractedAt: '2026-04-07T12:00:00.000Z',
          nextEpisodeAirDate: '2026-04-10T00:00:00.000Z',
          nextEpisodeMediaKey: 'episode:tmdb:100:1:2',
          nextEpisodeSeasonNumber: 1,
          nextEpisodeEpisodeNumber: 2,
          nextEpisodeAbsoluteEpisodeNumber: null,
          nextEpisodeTitle: 'Episode 2',
          metadataRefreshedAt: '2026-04-07T12:10:00.000Z',
          payload: { source: 'follow' },
        },
      ],
    } as never,
    {} as never,
  );

  const result = await service.getEpisodicFollowForAccount('user-1', 'profile-1', 10);

  assert.equal(result.length, 1);
  assert.deepEqual(result[0], {
    show: {
      mediaType: 'show',
      mediaKey: 'show:tmdb:100',
      provider: 'tmdb',
      providerId: '100',
      title: 'Example Show',
      posterUrl: 'https://img.test/poster.jpg',
      releaseYear: 2024,
      rating: 8.2,
      genre: null,
      subtitle: null,
    },
    reason: 'watchlist',
    lastInteractedAt: '2026-04-07T12:00:00.000Z',
    nextEpisodeAirDate: '2026-04-10T00:00:00.000Z',
    nextEpisodeMediaKey: 'episode:tmdb:100:1:2',
    nextEpisodeSeasonNumber: 1,
    nextEpisodeEpisodeNumber: 2,
    nextEpisodeAbsoluteEpisodeNumber: null,
    nextEpisodeTitle: 'Episode 2',
    metadataRefreshedAt: '2026-04-07T12:10:00.000Z',
    payload: { source: 'follow' },
  });
});

test('getEpisodicFollowForAccount preserves unresolved next episode rows', async (t) => {
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
    {
      buildCardView: async () => ({
        mediaType: 'show',
        mediaKey: 'show:tmdb:100',
        provider: 'tmdb',
        providerId: '100',
        title: 'Example Show',
        posterUrl: 'https://img.test/poster.jpg',
        releaseYear: 2024,
        rating: 8.2,
        genre: null,
        subtitle: null,
      }),
    } as never,
    {
      listEpisodicFollow: async () => [
        {
          seriesMediaKey: 'show:tmdb:100',
          seriesMediaType: 'show',
          provider: 'tmdb',
          providerId: '100',
          reason: 'watchlist',
          lastInteractedAt: '2026-04-07T12:00:00.000Z',
          nextEpisodeAirDate: '2026-04-12T00:00:00.000Z',
          nextEpisodeMediaKey: null,
          nextEpisodeSeasonNumber: null,
          nextEpisodeEpisodeNumber: null,
          nextEpisodeAbsoluteEpisodeNumber: null,
          nextEpisodeTitle: null,
          metadataRefreshedAt: '2026-04-07T12:10:00.000Z',
          payload: { source: 'follow' },
        },
      ],
    } as never,
    {} as never,
  );

  const result = await service.getEpisodicFollowForAccount('user-1', 'profile-1', 10);

  assert.equal(result.length, 1);
  assert.equal(result[0]?.nextEpisodeAirDate, '2026-04-12T00:00:00.000Z');
  assert.equal(result[0]?.nextEpisodeMediaKey, null);
});
