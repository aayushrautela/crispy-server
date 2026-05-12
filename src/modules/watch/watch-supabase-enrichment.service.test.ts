import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';
import type { WatchMediaCardCacheService } from './watch-media-card-cache.service.js';
import type { ContinueWatchingProductItem, HistoryProductItem, RatingProductItem } from './watch-derived-item.types.js';
import type { WatchStateResponse } from './watch-read.types.js';
import type { WatchMediaCardCacheRecord } from './watch-media-card-cache.repo.js';
import type { MediaItem } from '../metadata/media-item.types.js';

seedTestEnv();

const emptyExternalIds = { tmdb: null, imdb: null, tvdb: null };

function createMediaItem(overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    mediaKey: 'movie:tmdb:123',
    mediaType: 'movie',
    title: 'Supabase Fallback Title',
    originalTitle: null,
    subtitle: null,
    overview: null,
    posterUrl: 'https://supabase.test/poster.jpg',
    backdropUrl: 'https://supabase.test/backdrop.jpg',
    logoUrl: null,
    stillUrl: null,
    releaseDate: null,
    releaseYear: 2023,
    rating: 7.0,
    genres: [],
    runtimeMinutes: 120,
    status: null,
    certification: null,
    externalIds: emptyExternalIds,
    parent: null,
    showTmdbId: null,
    seasonNumber: null,
    episodeNumber: null,
    absoluteEpisodeNumber: null,
    episodeTitle: null,
    airDate: null,
    ...overrides,
  };
}

test('enrichContinueWatchingItems replaces mediaItem fields from cache', async () => {
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
      kind: 'continue_watching',
      mediaItem: createMediaItem(),
      context: {
        id: 'movie:tmdb:123',
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
      presentation: { preferredSize: 'wide', sectionId: null, sectionTitle: null },
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
  assert.equal(enriched[0]?.mediaItem.title, 'Cached Movie Title');
  assert.equal(enriched[0]?.mediaItem.posterUrl, 'https://cache.test/poster.jpg');
  assert.equal(enriched[0]?.mediaItem.backdropUrl, 'https://cache.test/backdrop.jpg');
  assert.equal(enriched[0]?.mediaItem.releaseYear, 2024);
  assert.equal(enriched[0]?.mediaItem.rating, 8.5);
  assert.equal(enriched[0]?.mediaItem.runtimeMinutes, 120);
  assert.equal(enriched[0]?.progress.positionSeconds, 300);
  assert.equal(enriched[0]?.lastActivityAt, '2026-05-11T10:00:00.000Z');
  assert.deepEqual(enriched[0]?.origins, ['local']);
});

test('enrichRegularMediaItems replaces mediaItem fields for history items', async () => {
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
      kind: 'watch_history',
      mediaItem: createMediaItem({
        mediaKey: 'show:tmdb:789',
        mediaType: 'show',
        title: 'Supabase Show Title',
        posterUrl: 'https://supabase.test/show-poster.jpg',
        releaseYear: 2021,
        rating: 8.0,
      }),
      context: {
        id: 'show:tmdb:789:2026-05-11',
        watchedAt: '2026-05-11T08:00:00.000Z',
        origins: ['simkl'],
      },
      presentation: { preferredSize: 'poster', sectionId: null, sectionTitle: null },
      watchedAt: '2026-05-11T08:00:00.000Z',
      origins: ['simkl'],
    },
  ];

  const enriched = await service.enrichRegularMediaItems({} as never, items);

  assert.equal(enriched.length, 1);
  assert.equal(enriched[0]?.mediaItem.title, 'Cached Show Title');
  assert.equal(enriched[0]?.mediaItem.posterUrl, 'https://cache.test/show-poster.jpg');
  assert.equal(enriched[0]?.mediaItem.subtitle, 'Season 1');
  assert.equal(enriched[0]?.mediaItem.releaseYear, 2022);
  assert.equal(enriched[0]?.mediaItem.rating, 9.1);
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
      kind: 'rating',
      mediaItem: createMediaItem({
        mediaKey: 'movie:tmdb:999',
        title: 'Uncached Movie',
        posterUrl: 'https://supabase.test/uncached.jpg',
        releaseYear: 2020,
        rating: 6.5,
      }),
      context: {
        id: 'movie:tmdb:999',
        rating: {
          value: 8,
          ratedAt: '2026-05-10T15:00:00.000Z',
        },
        origins: ['local'],
      },
      presentation: { preferredSize: 'poster', sectionId: null, sectionTitle: null },
      rating: {
        value: 8,
        ratedAt: '2026-05-10T15:00:00.000Z',
      },
      origins: ['local'],
    },
  ];

  const enriched = await service.enrichRegularMediaItems({} as never, items);

  assert.equal(enriched.length, 1);
  assert.equal(enriched[0]?.mediaItem.title, 'Uncached Movie');
  assert.equal(enriched[0]?.mediaItem.posterUrl, 'https://supabase.test/uncached.jpg');
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
      kind: 'watch_history',
      mediaItem: createMediaItem({
        mediaKey: 'movie:tmdb:111',
        title: 'Fallback',
        posterUrl: 'https://supabase.test/dup.jpg',
        releaseYear: 2022,
        rating: 7.0,
      }),
      context: {
        id: 'movie:tmdb:111:1',
        watchedAt: '2026-05-11T10:00:00.000Z',
        origins: ['local'],
      },
      presentation: { preferredSize: 'poster', sectionId: null, sectionTitle: null },
      watchedAt: '2026-05-11T10:00:00.000Z',
      origins: ['local'],
    },
    {
      id: 'movie:tmdb:111:2',
      kind: 'watch_history',
      mediaItem: createMediaItem({
        mediaKey: 'movie:tmdb:111',
        title: 'Fallback',
        posterUrl: 'https://supabase.test/dup.jpg',
        releaseYear: 2022,
        rating: 7.0,
      }),
      context: {
        id: 'movie:tmdb:111:2',
        watchedAt: '2026-05-11T11:00:00.000Z',
        origins: ['local'],
      },
      presentation: { preferredSize: 'poster', sectionId: null, sectionTitle: null },
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
