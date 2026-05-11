import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';
import type { WatchMediaCardCacheService } from './watch-media-card-cache.service.js';
import type { ContinueWatchingProductItem, HistoryProductItem, RatingProductItem } from './watch-derived-item.types.js';
import type { WatchStateResponse } from './watch-read.types.js';
import type { WatchMediaCardCacheRecord } from './watch-media-card-cache.repo.js';

seedTestEnv();

test('enrichContinueWatchingItems replaces media fields from cache while preserving user fields', async () => {
  const { WatchSupabaseEnrichmentService } = await import('./watch-supabase-enrichment.service.js');
  const cacheRecords = new Map<string, WatchMediaCardCacheRecord>([
    ['movie:tmdb:123', {
      mediaKey: 'movie:tmdb:123',
      mediaType: 'movie',
      titleProvider: 'tmdb',
      titleProviderId: '123',
      titleMediaType: 'movie',
      title: 'Cached Movie Title',
      subtitle: null,
      posterUrl: 'https://cache.test/poster.jpg',
      backdropUrl: 'https://cache.test/backdrop.jpg',
      releaseYear: 2024,
      rating: 8.5,
    }],
  ]);

  const watchMediaCardCacheService = {
    listCardCacheRecords: async () => cacheRecords,
  } as unknown as WatchMediaCardCacheService;

  const service = new WatchSupabaseEnrichmentService(watchMediaCardCacheService, {
    refreshMissingCards: async () => {},
  });

  const items: ContinueWatchingProductItem[] = [
    {
      id: 'movie:tmdb:123',
      media: {
        mediaType: 'movie',
        mediaKey: 'movie:tmdb:123',
        title: 'Supabase Fallback Title',
        posterUrl: 'https://supabase.test/poster.jpg',
        backdropUrl: 'https://supabase.test/backdrop.jpg',
        releaseYear: 2023,
        rating: 7.0,
        genre: null,
        seasonNumber: null,
        episodeNumber: null,
        episodeTitle: null,
        airDate: null,
        runtimeMinutes: 120,
      },
      progress: {
        positionSeconds: 300,
        durationSeconds: 7200,
        progressPercent: 4.17,
        status: 'in_progress',
        lastPlayedAt: '2026-05-11T10:00:00.000Z',
      },
      lastActivityAt: '2026-05-11T10:00:00.000Z',
      origins: ['local'],
      dismissible: true,
    },
  ];

  const enriched = await service.enrichContinueWatchingItems({} as never, items);

  assert.equal(enriched.length, 1);
  assert.equal(enriched[0]?.media.title, 'Cached Movie Title');
  assert.equal(enriched[0]?.media.posterUrl, 'https://cache.test/poster.jpg');
  assert.equal(enriched[0]?.media.backdropUrl, 'https://cache.test/backdrop.jpg');
  assert.equal(enriched[0]?.media.releaseYear, 2024);
  assert.equal(enriched[0]?.media.rating, 8.5);
  assert.equal(enriched[0]?.media.runtimeMinutes, 120);
  assert.equal(enriched[0]?.progress.positionSeconds, 300);
  assert.equal(enriched[0]?.lastActivityAt, '2026-05-11T10:00:00.000Z');
  assert.deepEqual(enriched[0]?.origins, ['local']);
});

test('enrichContinueWatchingItems uses fallback backdrop when cache has no backdrop', async () => {
  const { WatchSupabaseEnrichmentService } = await import('./watch-supabase-enrichment.service.js');
  const cacheRecords = new Map<string, WatchMediaCardCacheRecord>([
    ['movie:tmdb:456', {
      mediaKey: 'movie:tmdb:456',
      mediaType: 'movie',
      titleProvider: 'tmdb',
      titleProviderId: '456',
      titleMediaType: 'movie',
      title: 'Movie Without Backdrop',
      subtitle: null,
      posterUrl: 'https://cache.test/poster.jpg',
      backdropUrl: null,
      releaseYear: 2025,
      rating: 7.8,
    }],
  ]);

  const watchMediaCardCacheService = {
    listCardCacheRecords: async () => cacheRecords,
  } as unknown as WatchMediaCardCacheService;

  const service = new WatchSupabaseEnrichmentService(watchMediaCardCacheService, {
    refreshMissingCards: async () => {},
  });

  const items: ContinueWatchingProductItem[] = [
    {
      id: 'movie:tmdb:456',
      media: {
        mediaType: 'movie',
        mediaKey: 'movie:tmdb:456',
        title: 'Fallback Title',
        posterUrl: 'https://supabase.test/poster.jpg',
        backdropUrl: 'https://supabase.test/backdrop.jpg',
        releaseYear: 2023,
        rating: 7.0,
        genre: null,
        seasonNumber: null,
        episodeNumber: null,
        episodeTitle: null,
        airDate: null,
        runtimeMinutes: 90,
      },
      progress: {
        positionSeconds: 100,
        durationSeconds: 5400,
        progressPercent: 1.85,
        status: 'in_progress',
        lastPlayedAt: '2026-05-11T12:00:00.000Z',
      },
      lastActivityAt: '2026-05-11T12:00:00.000Z',
      origins: ['trakt'],
      dismissible: true,
    },
  ];

  const enriched = await service.enrichContinueWatchingItems({} as never, items);

  assert.equal(enriched[0]?.media.backdropUrl, 'https://supabase.test/backdrop.jpg');
});

test('enrichRegularMediaItems replaces media fields for history items', async () => {
  const { WatchSupabaseEnrichmentService } = await import('./watch-supabase-enrichment.service.js');
  const cacheRecords = new Map<string, WatchMediaCardCacheRecord>([
    ['show:tmdb:789', {
      mediaKey: 'show:tmdb:789',
      mediaType: 'show',
      titleProvider: 'tmdb',
      titleProviderId: '789',
      titleMediaType: 'show',
      title: 'Cached Show Title',
      subtitle: 'Season 1',
      posterUrl: 'https://cache.test/show-poster.jpg',
      backdropUrl: 'https://cache.test/show-backdrop.jpg',
      releaseYear: 2022,
      rating: 9.1,
    }],
  ]);

  const watchMediaCardCacheService = {
    listCardCacheRecords: async () => cacheRecords,
  } as unknown as WatchMediaCardCacheService;

  const service = new WatchSupabaseEnrichmentService(watchMediaCardCacheService, {
    refreshMissingCards: async () => {},
  });

  const items: HistoryProductItem[] = [
    {
      id: 'show:tmdb:789:2026-05-11',
      media: {
        mediaType: 'show',
        mediaKey: 'show:tmdb:789',
        title: 'Supabase Show Title',
        posterUrl: 'https://supabase.test/show-poster.jpg',
        releaseYear: 2021,
        rating: 8.0,
        genre: null,
        subtitle: null,
      },
      watchedAt: '2026-05-11T08:00:00.000Z',
      origins: ['simkl'],
    },
  ];

  const enriched = await service.enrichRegularMediaItems({} as never, items);

  assert.equal(enriched.length, 1);
  assert.equal(enriched[0]?.media.title, 'Cached Show Title');
  assert.equal(enriched[0]?.media.posterUrl, 'https://cache.test/show-poster.jpg');
  assert.equal(enriched[0]?.media.subtitle, 'Season 1');
  assert.equal(enriched[0]?.media.releaseYear, 2022);
  assert.equal(enriched[0]?.media.rating, 9.1);
  assert.equal(enriched[0]?.watchedAt, '2026-05-11T08:00:00.000Z');
  assert.deepEqual(enriched[0]?.origins, ['simkl']);
});

test('enrichRegularMediaItems handles cache misses gracefully', async () => {
  const { WatchSupabaseEnrichmentService } = await import('./watch-supabase-enrichment.service.js');
  const cacheRecords = new Map<string, WatchMediaCardCacheRecord>();

  const watchMediaCardCacheService = {
    listCardCacheRecords: async () => cacheRecords,
  } as unknown as WatchMediaCardCacheService;

  const service = new WatchSupabaseEnrichmentService(watchMediaCardCacheService, {
    refreshMissingCards: async () => {},
  });

  const items: RatingProductItem[] = [
    {
      id: 'movie:tmdb:999',
      media: {
        mediaType: 'movie',
        mediaKey: 'movie:tmdb:999',
        title: 'Uncached Movie',
        posterUrl: 'https://supabase.test/uncached.jpg',
        releaseYear: 2020,
        rating: 6.5,
        genre: null,
        subtitle: null,
      },
      rating: {
        value: 8,
        ratedAt: '2026-05-10T15:00:00.000Z',
      },
      origins: ['local'],
    },
  ];

  const enriched = await service.enrichRegularMediaItems({} as never, items);

  assert.equal(enriched.length, 1);
  assert.equal(enriched[0]?.media.title, 'Uncached Movie');
  assert.equal(enriched[0]?.media.posterUrl, 'https://supabase.test/uncached.jpg');
  assert.equal(enriched[0]?.rating.value, 8);
});

test('enrichRegularMediaItems deduplicates media keys', async () => {
  const { WatchSupabaseEnrichmentService } = await import('./watch-supabase-enrichment.service.js');
  let receivedMediaKeys: string[] = [];

  const cacheRecords = new Map<string, WatchMediaCardCacheRecord>([
    ['movie:tmdb:111', {
      mediaKey: 'movie:tmdb:111',
      mediaType: 'movie',
      titleProvider: 'tmdb',
      titleProviderId: '111',
      titleMediaType: 'movie',
      title: 'Duplicate Movie',
      subtitle: null,
      posterUrl: 'https://cache.test/dup.jpg',
      backdropUrl: null,
      releaseYear: 2023,
      rating: 7.5,
    }],
  ]);

  const watchMediaCardCacheService = {
    listCardCacheRecords: async (_client: unknown, mediaKeys: string[]) => {
      receivedMediaKeys = mediaKeys;
      return cacheRecords;
    },
  } as unknown as WatchMediaCardCacheService;

  const service = new WatchSupabaseEnrichmentService(watchMediaCardCacheService, {
    refreshMissingCards: async () => {},
  });

  const items: HistoryProductItem[] = [
    {
      id: 'movie:tmdb:111:1',
      media: {
        mediaType: 'movie',
        mediaKey: 'movie:tmdb:111',
        title: 'Fallback',
        posterUrl: 'https://supabase.test/dup.jpg',
        releaseYear: 2022,
        rating: 7.0,
        genre: null,
        subtitle: null,
      },
      watchedAt: '2026-05-11T10:00:00.000Z',
      origins: ['local'],
    },
    {
      id: 'movie:tmdb:111:2',
      media: {
        mediaType: 'movie',
        mediaKey: 'movie:tmdb:111',
        title: 'Fallback',
        posterUrl: 'https://supabase.test/dup.jpg',
        releaseYear: 2022,
        rating: 7.0,
        genre: null,
        subtitle: null,
      },
      watchedAt: '2026-05-11T11:00:00.000Z',
      origins: ['local'],
    },
  ];

  await service.enrichRegularMediaItems({} as never, items);

  assert.equal(receivedMediaKeys.length, 1);
  assert.equal(receivedMediaKeys[0], 'movie:tmdb:111');
});

test('enrichRegularMediaItems handles empty items array', async () => {
  const { WatchSupabaseEnrichmentService } = await import('./watch-supabase-enrichment.service.js');
  const watchMediaCardCacheService = {
    listCardCacheRecords: async () => new Map(),
  } as unknown as WatchMediaCardCacheService;

  const service = new WatchSupabaseEnrichmentService(watchMediaCardCacheService, {
    refreshMissingCards: async () => {},
  });

  const enriched = await service.enrichRegularMediaItems<WatchStateResponse>({} as never, []);

  assert.equal(enriched.length, 0);
});
