import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';
import type { WatchMediaCardCacheService } from './watch-media-card-cache.service.js';
import type { ContinueWatchingProductItem, HistoryProductItem, RatingProductItem } from './watch-derived-item.types.js';
import type { WatchStateResponse } from './watch-read.types.js';
import type { WatchMediaCardCacheRecord } from './watch-media-card-cache.repo.js';
import type { MediaItemDto } from '../metadata/media-item.types.js';

seedTestEnv();

const emptyImageSet = () => ({ small: null, medium: null, large: null });
const imageSet = (value: string) => ({ small: value, medium: value, large: value });

function createMediaItemDto(overrides: Partial<MediaItemDto> = {}): MediaItemDto {
  return {
    id: 'movie:tmdb:123',
    mediaKey: 'movie:tmdb:123',
    type: 'Movie',
    name: 'Fallback Title',
    originalTitle: null,
    overview: null,
    tagline: null,
    productionYear: 2023,
    premiereDate: null,
    communityRating: 7.0,
    officialRating: null,
    certification: null,
    genres: [],
    runTimeSeconds: null,
    status: null,
    providerIds: { tmdb: '123', imdb: null, tvdb: null },
    imageTags: {
      primary: imageSet('https://media.test/poster.jpg'),
      backdrop: [imageSet('https://media.test/backdrop.jpg')],
      logo: imageSet('https://media.test/logo.jpg'),
      thumb: null,
      screenshot: [],
    },
    parentImageTags: null,
    seriesId: null,
    seriesName: null,
    seasonId: null,
    seasonName: null,
    parentIndexNumber: null,
    indexNumber: null,
    absoluteIndexNumber: null,
    episodeTitle: null,
    airDate: null,
    trailerUrl: null,
    trailerThumbnailUrl: null,
    posterColor: null,
    backdropColor: null,
    userData: null,
    ...overrides,
  };
}

test('enrichContinueWatchingItems replaces mediaItem fields from cache', async () => {
  const { WatchMetadataEnrichmentService } = await import('./watch-metadata-enrichment.service.js');
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
      stillUrl: null,
      logoUrl: 'https://cache.test/logo.png',
      trailerUrl: 'https://youtube.test/watch?v=abc',
      trailerThumbnailUrl: 'https://youtube.test/thumb.jpg',
      posterColor: '#111111',
      backdropColor: '#222222',
      releaseYear: 2024,
      rating: 8.5,
      maturityRating: 'PG-13',
      genres: ['Action'],
      language: 'en',
    }],
  ]);

  const watchMediaCardCacheService = {
    listCardCacheRecords: async () => cacheRecords,
  } as unknown as WatchMediaCardCacheService;

  const service = new WatchMetadataEnrichmentService(watchMediaCardCacheService, {
    refreshMissingCardsAndReturnRecords: async () => new Map(),
  });

  const items: ContinueWatchingProductItem[] = [
    {
      id: 'movie:tmdb:123',
      kind: 'continue_watching',
      mediaItem: createMediaItemDto(),
      context: {
        id: 'movie:tmdb:123',
        progress: {
          positionSeconds: 300,
          durationSeconds: 7200,
          progressPercent: 4.17,
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
        lastPlayedAt: '2026-05-11T10:00:00.000Z',
      },
      lastActivityAt: '2026-05-11T10:00:00.000Z',
      origins: ['local'],
      dismissible: true,
    },
  ];

  const enriched = await service.enrichContinueWatchingItems({} as never, items);

  assert.equal(enriched.length, 1);
  assert.equal(enriched[0]?.mediaItem.name, 'Cached Movie Title');
  assert.deepEqual(enriched[0]?.mediaItem.imageTags.primary, { small: 'https://cache.test/poster.jpg', medium: 'https://cache.test/poster.jpg', large: 'https://cache.test/poster.jpg' });
  assert.equal(enriched[0]?.mediaItem.productionYear, 2024);
  assert.equal(enriched[0]?.mediaItem.communityRating, 8.5);
  assert.deepEqual(enriched[0]?.mediaItem.genres, ['Action']);
  assert.equal(enriched[0]?.mediaItem.trailerUrl, 'https://youtube.test/watch?v=abc');
  assert.equal(enriched[0]?.mediaItem.trailerThumbnailUrl, 'https://youtube.test/thumb.jpg');
  assert.equal(enriched[0]?.mediaItem.posterColor, '#111111');
  assert.equal(enriched[0]?.mediaItem.backdropColor, '#222222');
  assert.equal(enriched[0]?.mediaItem.runTimeSeconds, null);
  assert.equal(enriched[0]?.progress.positionSeconds, 300);
  assert.equal(enriched[0]?.lastActivityAt, '2026-05-11T10:00:00.000Z');
  assert.deepEqual(enriched[0]?.origins, ['local']);
});

test('enrichContinueWatchingItems enriches parent title for episode items', async () => {
  const { WatchMetadataEnrichmentService } = await import('./watch-metadata-enrichment.service.js');
  const cacheRecords = new Map<string, WatchMediaCardCacheRecord>([
    ['episode:tmdb:123:2:5', {
      mediaKey: 'episode:tmdb:123:2:5',
      mediaType: 'episode',
      titleProvider: 'tmdb',
      titleProviderId: '123',
      titleMediaType: 'show',
      title: 'Episode 5 Title',
      subtitle: null,
      posterUrl: 'https://cache.test/ep-poster.jpg',
      backdropUrl: 'https://cache.test/ep-backdrop.jpg',
      stillUrl: 'https://cache.test/ep-still.jpg',
      logoUrl: null,
      trailerUrl: null,
      trailerThumbnailUrl: null,
      posterColor: null,
      backdropColor: null,
      releaseYear: 2023,
      rating: 8.0,
      maturityRating: null,
      genres: ['Drama'],
      language: 'en',
    }],
    ['show:tmdb:123', {
      mediaKey: 'show:tmdb:123',
      mediaType: 'show',
      titleProvider: 'tmdb',
      titleProviderId: '123',
      titleMediaType: 'show',
      title: 'Parent Show Title',
      subtitle: null,
      posterUrl: 'https://cache.test/show-poster.jpg',
      backdropUrl: 'https://cache.test/show-backdrop.jpg',
      stillUrl: null,
      logoUrl: null,
      trailerUrl: null,
      trailerThumbnailUrl: null,
      posterColor: null,
      backdropColor: null,
      releaseYear: 2022,
      rating: 9.0,
      maturityRating: null,
      genres: ['Drama'],
      language: 'en',
    }],
  ]);

  const watchMediaCardCacheService = {
    listCardCacheRecords: async () => cacheRecords,
  } as unknown as WatchMediaCardCacheService;

  const service = new WatchMetadataEnrichmentService(watchMediaCardCacheService, {
    refreshMissingCardsAndReturnRecords: async () => new Map(),
  });

  const items: ContinueWatchingProductItem[] = [
    {
      id: 'show:tmdb:123',
      kind: 'continue_watching',
      mediaItem: createMediaItemDto({
        mediaKey: 'episode:tmdb:123:2:5',
        id: 'show:tmdb:123',
        type: 'Episode',
        seriesId: '123',
        parentIndexNumber: 2,
        indexNumber: 5,
      }),
      context: {
        id: 'show:tmdb:123',
        progress: {
          positionSeconds: 600,
          durationSeconds: 1800,
          progressPercent: 33.33,
          lastPlayedAt: '2026-05-14T08:00:00.000Z',
        },
        lastActivityAt: '2026-05-14T08:00:00.000Z',
        origins: ['local'],
        dismissible: true,
      },
      presentation: { preferredSize: 'wide', sectionId: null, sectionTitle: null },
      progress: {
        positionSeconds: 600,
        durationSeconds: 1800,
        progressPercent: 33.33,
        lastPlayedAt: '2026-05-14T08:00:00.000Z',
      },
      lastActivityAt: '2026-05-14T08:00:00.000Z',
      origins: ['local'],
      dismissible: true,
    },
  ];

  const enriched = await service.enrichContinueWatchingItems({} as never, items);

  assert.equal(enriched.length, 1);
  assert.equal(enriched[0]?.mediaItem.mediaKey, 'episode:tmdb:123:2:5');
  assert.equal(enriched[0]?.mediaItem.type, 'Episode');
  assert.equal(enriched[0]?.mediaItem.seriesName, 'Parent Show Title');
  assert.equal(enriched[0]?.mediaItem.name, 'Episode 5 Title');
  assert.equal(enriched[0]?.mediaItem.seriesId, '123');
  assert.equal(enriched[0]?.mediaItem.parentIndexNumber, 2);
  assert.equal(enriched[0]?.mediaItem.indexNumber, 5);
  assert.ok(enriched[0]?.mediaItem.imageTags.thumb);
  assert.ok(enriched[0]?.mediaItem.imageTags.backdrop.length > 0);
  assert.equal(enriched[0]?.mediaItem.episodeTitle, 'Episode 5 Title');
});

test('enrichContinueWatchingItems drops episode items missing parent show record', async () => {
  const { WatchMetadataEnrichmentService } = await import('./watch-metadata-enrichment.service.js');
  const cacheRecords = new Map<string, WatchMediaCardCacheRecord>([
    ['episode:tmdb:999:1:1', {
      mediaKey: 'episode:tmdb:999:1:1',
      mediaType: 'episode',
      titleProvider: 'tmdb',
      titleProviderId: '999',
      titleMediaType: 'show',
      title: 'Orphan Episode',
      subtitle: null,
      posterUrl: null,
      backdropUrl: null,
      stillUrl: null,
      logoUrl: null,
      trailerUrl: null,
      trailerThumbnailUrl: null,
      posterColor: null,
      backdropColor: null,
      releaseYear: null,
      rating: null,
      maturityRating: null,
      genres: [],
      language: 'en',
    }],
  ]);

  const watchMediaCardCacheService = {
    listCardCacheRecords: async () => cacheRecords,
  } as unknown as WatchMediaCardCacheService;

  const service = new WatchMetadataEnrichmentService(watchMediaCardCacheService, {
    refreshMissingCardsAndReturnRecords: async () => new Map(),
  });

  const items: ContinueWatchingProductItem[] = [
    {
      id: 'show:tmdb:999',
      kind: 'continue_watching',
      mediaItem: createMediaItemDto({
        mediaKey: 'episode:tmdb:999:1:1',
        id: 'show:tmdb:999',
        type: 'Episode',
        seriesId: '999',
        parentIndexNumber: 1,
        indexNumber: 1,
      }),
      context: {
        id: 'show:tmdb:999',
        progress: {
          positionSeconds: 100,
          durationSeconds: 1800,
          progressPercent: 5.56,
          lastPlayedAt: '2026-05-14T10:00:00.000Z',
        },
        lastActivityAt: '2026-05-14T10:00:00.000Z',
        origins: ['local'],
        dismissible: true,
      },
      presentation: { preferredSize: 'wide', sectionId: null, sectionTitle: null },
      progress: {
        positionSeconds: 100,
        durationSeconds: 1800,
        progressPercent: 5.56,
        lastPlayedAt: '2026-05-14T10:00:00.000Z',
      },
      lastActivityAt: '2026-05-14T10:00:00.000Z',
      origins: ['local'],
      dismissible: true,
    },
  ];

  const enriched = await service.enrichContinueWatchingItems({} as never, items);

  assert.equal(enriched.length, 0);
});

test('enrichRegularMediaItems replaces mediaItem fields for history items', async () => {
  const { WatchMetadataEnrichmentService } = await import('./watch-metadata-enrichment.service.js');
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
      stillUrl: null,
      logoUrl: null,
      trailerUrl: null,
      trailerThumbnailUrl: null,
      posterColor: null,
      backdropColor: null,
      releaseYear: 2022,
      rating: 9.1,
      maturityRating: null,
      genres: ['Drama'],
      language: 'en',
    }],
  ]);

  const watchMediaCardCacheService = {
    listCardCacheRecords: async () => cacheRecords,
  } as unknown as WatchMediaCardCacheService;

  const service = new WatchMetadataEnrichmentService(watchMediaCardCacheService, {
    refreshMissingCardsAndReturnRecords: async () => new Map(),
  });

  const items: HistoryProductItem[] = [
    {
      id: 'show:tmdb:789:2026-05-11',
      kind: 'watch_history',
      mediaItem: createMediaItemDto({
        mediaKey: 'show:tmdb:789',
        id: 'show:tmdb:789',
        type: 'Series',
        name: 'Fallback Show Title',
        imageTags: {
          primary: imageSet('https://media.test/show-poster.jpg'),
          backdrop: [imageSet('https://media.test/backdrop.jpg')],
          logo: null,
          thumb: null,
          screenshot: [],
        },
        productionYear: 2021,
        communityRating: 8.0,
        providerIds: { tmdb: '789', imdb: null, tvdb: null },
      }),
      context: {
        id: 'show:tmdb:789:2026-05-11',
        eventType: 'playback_completed',
        occurredAt: '2026-05-11T08:00:00.000Z',
        watchedAt: '2026-05-11T08:00:00.000Z',
        origins: ['simkl'],
      },
      presentation: { preferredSize: 'poster', sectionId: null, sectionTitle: null },
      eventType: 'playback_completed',
      occurredAt: '2026-05-11T08:00:00.000Z',
      watchedAt: '2026-05-11T08:00:00.000Z',
      origins: ['simkl'],
    },
  ];

  const enriched = await service.enrichRegularMediaItems({} as never, items);

  assert.equal(enriched.length, 1);
  assert.equal(enriched[0]?.mediaItem.name, 'Cached Show Title');
  assert.deepEqual(enriched[0]?.mediaItem.imageTags.primary, { small: 'https://cache.test/show-poster.jpg', medium: 'https://cache.test/show-poster.jpg', large: 'https://cache.test/show-poster.jpg' });
  assert.equal(enriched[0]?.mediaItem.communityRating, 9.1);
  assert.deepEqual(enriched[0]?.mediaItem.genres, ['Drama']);
  assert.equal(enriched[0]?.watchedAt, '2026-05-11T08:00:00.000Z');
  assert.deepEqual(enriched[0]?.origins, ['simkl']);
});

test('enrichRegularMediaItems handles cache misses gracefully', async () => {
  const { WatchMetadataEnrichmentService } = await import('./watch-metadata-enrichment.service.js');
  const cacheRecords = new Map<string, WatchMediaCardCacheRecord>();

  const watchMediaCardCacheService = {
    listCardCacheRecords: async () => cacheRecords,
  } as unknown as WatchMediaCardCacheService;

  const service = new WatchMetadataEnrichmentService(watchMediaCardCacheService, {
    refreshMissingCardsAndReturnRecords: async () => new Map(),
  });

  const items: RatingProductItem[] = [
    {
      id: 'movie:tmdb:999',
      kind: 'rating',
      mediaItem: createMediaItemDto({
        mediaKey: 'movie:tmdb:999',
        id: 'movie:tmdb:999',
        type: 'Movie',
        name: 'Uncached Movie',
        imageTags: {
          primary: imageSet('https://media.test/uncached.jpg'),
          backdrop: [imageSet('https://media.test/backdrop.jpg')],
          logo: null,
          thumb: null,
          screenshot: [],
        },
        productionYear: 2020,
        communityRating: 6.5,
        providerIds: { tmdb: '999', imdb: null, tvdb: null },
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
  assert.equal(enriched[0]?.mediaItem.name, 'Uncached Movie');
  assert.deepEqual(enriched[0]?.mediaItem.imageTags.primary, imageSet('https://media.test/uncached.jpg'));
  assert.equal(enriched[0]?.rating.value, 8);
});

test('enrichRegularMediaItems deduplicates media keys', async () => {
  const { WatchMetadataEnrichmentService } = await import('./watch-metadata-enrichment.service.js');
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
      stillUrl: null,
      logoUrl: null,
      trailerUrl: null,
      trailerThumbnailUrl: null,
      posterColor: null,
      backdropColor: null,
      releaseYear: 2023,
      rating: 7.5,
      maturityRating: null,
      genres: ['Comedy'],
      language: 'en',
    }],
  ]);

  const watchMediaCardCacheService = {
    listCardCacheRecords: async (_client: unknown, mediaKeys: string[]) => {
      receivedMediaKeys = mediaKeys;
      return cacheRecords;
    },
  } as unknown as WatchMediaCardCacheService;

  const service = new WatchMetadataEnrichmentService(watchMediaCardCacheService, {
    refreshMissingCardsAndReturnRecords: async () => new Map(),
  });

  const items: HistoryProductItem[] = [
    {
      id: 'movie:tmdb:111:1',
      kind: 'watch_history',
      mediaItem: createMediaItemDto({
        mediaKey: 'movie:tmdb:111',
        id: 'movie:tmdb:111',
        type: 'Movie',
        name: 'Fallback',
        imageTags: {
          primary: imageSet('https://media.test/dup.jpg'),
          backdrop: [imageSet('https://media.test/backdrop.jpg')],
          logo: null,
          thumb: null,
          screenshot: [],
        },
        productionYear: 2022,
        communityRating: 7.0,
        providerIds: { tmdb: '111', imdb: null, tvdb: null },
      }),
      context: {
        id: 'movie:tmdb:111:1',
        eventType: 'playback_completed',
        occurredAt: '2026-05-11T10:00:00.000Z',
        watchedAt: '2026-05-11T10:00:00.000Z',
        origins: ['local'],
      },
      presentation: { preferredSize: 'poster', sectionId: null, sectionTitle: null },
      eventType: 'playback_completed',
      occurredAt: '2026-05-11T10:00:00.000Z',
      watchedAt: '2026-05-11T10:00:00.000Z',
      origins: ['local'],
    },
    {
      id: 'movie:tmdb:111:2',
      kind: 'watch_history',
      mediaItem: createMediaItemDto({
        mediaKey: 'movie:tmdb:111',
        id: 'movie:tmdb:111',
        type: 'Movie',
        name: 'Fallback',
        imageTags: {
          primary: imageSet('https://media.test/dup.jpg'),
          backdrop: [imageSet('https://media.test/backdrop.jpg')],
          logo: null,
          thumb: null,
          screenshot: [],
        },
        productionYear: 2022,
        communityRating: 7.0,
        providerIds: { tmdb: '111', imdb: null, tvdb: null },
      }),
      context: {
        id: 'movie:tmdb:111:2',
        eventType: 'playback_completed',
        occurredAt: '2026-05-11T11:00:00.000Z',
        watchedAt: '2026-05-11T11:00:00.000Z',
        origins: ['local'],
      },
      presentation: { preferredSize: 'poster', sectionId: null, sectionTitle: null },
      eventType: 'playback_completed',
      occurredAt: '2026-05-11T11:00:00.000Z',
      watchedAt: '2026-05-11T11:00:00.000Z',
      origins: ['local'],
    },
  ];

  await service.enrichRegularMediaItems({} as never, items);

  assert.equal(receivedMediaKeys.length, 1);
  assert.equal(receivedMediaKeys[0], 'movie:tmdb:111');
});

test('enrichRegularMediaItems handles empty items array', async () => {
  const { WatchMetadataEnrichmentService } = await import('./watch-metadata-enrichment.service.js');
  const watchMediaCardCacheService = {
    listCardCacheRecords: async () => new Map(),
  } as unknown as WatchMediaCardCacheService;

  const service = new WatchMetadataEnrichmentService(watchMediaCardCacheService, {
    refreshMissingCardsAndReturnRecords: async () => new Map(),
  });

  const enriched = await service.enrichRegularMediaItems<WatchStateResponse>({} as never, []);

  assert.equal(enriched.length, 0);
});
