import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';
import type { WatchMediaCardCacheRecord } from './watch-media-card-cache.repo.js';

seedTestEnv();

test('refreshMissingCardsAndReturnRecords reads refreshed records in requested language', async () => {
  const { WatchCacheMissRefreshService } = await import('./watch-cache-miss-refresh.service.js');
  const calls: Array<{ mediaKeys: string[]; language?: string | null }> = [];
  const localizedRecord: WatchMediaCardCacheRecord = {
    mediaKey: 'movie:tmdb:123',
    mediaType: 'movie',
    titleProvider: 'tmdb',
    titleProviderId: '123',
    titleMediaType: 'movie',
    title: 'Localized Movie',
    subtitle: null,
    posterUrl: 'https://cache.test/poster.jpg',
    backdropUrl: null,
    logoUrl: null,
    trailerUrl: null,
    trailerThumbnailUrl: null,
    posterColor: null,
    backdropColor: null,
    releaseYear: 2024,
    rating: 8.5,
    maturityRating: null,
    genres: [],
    language: 'en-US',
  };

  const projectionService = {
    buildWatchProjection: async () => ({
      detailsTitleMediaType: 'movie',
      playbackParentProvider: null,
      playbackParentProviderId: null,
      title: 'Localized Movie',
      subtitle: null,
      posterUrl: 'https://cache.test/poster.jpg',
      backdropUrl: null,
      logoUrl: null,
      trailerUrl: null,
      trailerThumbnailUrl: null,
      posterColor: null,
      backdropColor: null,
      detailsReleaseYear: 2024,
      detailsRating: 8.5,
      maturityRating: null,
      genres: [],
    }),
  };
  const cacheService = {
    upsertFromProjection: async () => undefined,
    listCardCacheRecords: async (_client: unknown, mediaKeys: string[], language?: string | null) => {
      calls.push({ mediaKeys, language });
      return language === 'en-US'
        ? new Map([['movie:tmdb:123', localizedRecord]])
        : new Map<string, WatchMediaCardCacheRecord>();
    },
  };

  const service = new WatchCacheMissRefreshService(projectionService as never, cacheService as never);
  const records = await service.refreshMissingCardsAndReturnRecords({} as never, ['movie:tmdb:123'], 'en-US');

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.language, 'en-US');
  assert.equal(records.get('movie:tmdb:123')?.posterUrl, 'https://cache.test/poster.jpg');
});
