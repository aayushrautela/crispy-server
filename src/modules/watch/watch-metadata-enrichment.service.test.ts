import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';
import type { WatchMediaCardCacheService } from './watch-media-card-cache.service.js';
import type { ContinueWatchingProductItem, HistoryProductItem, RatingProductItem } from './watch-derived-item.types.js';
import type { WatchStateResponse } from './watch-read.types.js';
import type { WatchMediaCardCacheRecord } from './watch-media-card-cache.repo.js';
import type { MediaItemDto } from '../metadata/media-item.types.js';

seedTestEnv();

const imageSet = (value: string) => ({ small: value, medium: value, large: value });

function createMediaItemDto(overrides: Partial<MediaItemDto> = {}): MediaItemDto {
  return {
    Id: 'movie:tmdb:123',
    Type: 'Movie',
    Name: 'Fallback Title',
    OriginalTitle: null,
    Overview: null,
    Taglines: [],
    ProductionYear: 2023,
    PremiereDate: null,
    CommunityRating: 7.0,
    OfficialRating: null,
    Certification: null,
    Genres: [],
    RunTimeTicks: null,
    Status: null,
    ProviderIds: { Tmdb: '123', Imdb: null, Tvdb: null },
    ImageTags: {
      Primary: imageSet('https://media.test/poster.jpg'),
      Backdrop: [imageSet('https://media.test/backdrop.jpg')],
      Logo: imageSet('https://media.test/logo.jpg'),
      Thumb: null,
      Screenshot: [],
    },
    ParentImageTags: null,
    SeriesId: null,
    SeriesName: null,
    SeasonId: null,
    SeasonName: null,
    ParentIndexNumber: null,
    IndexNumber: null,
    AbsoluteIndexNumber: null,
    EpisodeTitle: null,
    AirDate: null,
    RemoteTrailers: [],
    PosterColor: null,
    BackdropColor: null,
    UserData: null,
    ...overrides,
  };
}

function createCacheRecord(overrides: Partial<WatchMediaCardCacheRecord> = {}): WatchMediaCardCacheRecord {
  return {
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
    trailerUrl: null,
    trailerThumbnailUrl: null,
    posterColor: null,
    backdropColor: null,
    releaseYear: 2024,
    rating: 8.5,
    maturityRating: 'PG-13',
    genres: ['Action'],
    language: 'en',
    overview: null,
    runtimeMinutes: null,
    releaseDate: null,
    status: null,
    episodeTitle: null,
    episodeAirDate: null,
    ...overrides,
  };
}

test('enrichContinueWatchingItems replaces mediaItem fields from cache', async () => {
  const { WatchMetadataEnrichmentService } = await import('./watch-metadata-enrichment.service.js');
  const cacheRecords = new Map<string, WatchMediaCardCacheRecord>([
    ['movie:tmdb:123', createCacheRecord({
      trailerUrl: 'https://youtube.test/watch?v=abc',
      trailerThumbnailUrl: 'https://youtube.test/thumb.jpg',
      posterColor: '#111111',
      backdropColor: '#222222',
    })],
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
  assert.equal(enriched[0]?.mediaItem.Name, 'Cached Movie Title');
  assert.deepEqual(enriched[0]?.mediaItem.ImageTags.Primary, imageSet('https://cache.test/poster.jpg'));
  assert.equal(enriched[0]?.mediaItem.ProductionYear, 2024);
  assert.equal(enriched[0]?.mediaItem.CommunityRating, 8.5);
  assert.deepEqual(enriched[0]?.mediaItem.Genres, ['Action']);
  assert.equal(enriched[0]?.mediaItem.RemoteTrailers[0]?.Url, 'https://youtube.test/watch?v=abc');
  assert.equal(enriched[0]?.mediaItem.RemoteTrailers[0]?.ThumbnailUrl, 'https://youtube.test/thumb.jpg');
  assert.equal(enriched[0]?.mediaItem.PosterColor, '#111111');
  assert.equal(enriched[0]?.mediaItem.BackdropColor, '#222222');
  assert.equal(enriched[0]?.mediaItem.RunTimeTicks, null);
  assert.equal(enriched[0]?.progress.positionSeconds, 300);
  assert.equal(enriched[0]?.lastActivityAt, '2026-05-11T10:00:00.000Z');
  assert.deepEqual(enriched[0]?.origins, ['local']);
});

test('enrichContinueWatchingItems enriches parent title for episode items', async () => {
  const { WatchMetadataEnrichmentService } = await import('./watch-metadata-enrichment.service.js');
  const cacheRecords = new Map<string, WatchMediaCardCacheRecord>([
    ['episode:tmdb:123:2:5', createCacheRecord({
      mediaKey: 'episode:tmdb:123:2:5',
      mediaType: 'episode',
      titleMediaType: 'show',
      title: 'Parent Show Title',
      posterUrl: 'https://cache.test/ep-poster.jpg',
      backdropUrl: 'https://cache.test/ep-backdrop.jpg',
      stillUrl: 'https://cache.test/ep-still.jpg',
      logoUrl: null,
      rating: 8.0,
      maturityRating: null,
      genres: ['Drama'],
      releaseYear: 2023,
      episodeTitle: 'Episode 5 Title',
    })],
    ['show:tmdb:123', createCacheRecord({
      mediaKey: 'show:tmdb:123',
      mediaType: 'show',
      titleMediaType: 'show',
      title: 'Parent Show Title',
      posterUrl: 'https://cache.test/show-poster.jpg',
      backdropUrl: 'https://cache.test/show-backdrop.jpg',
      logoUrl: null,
      rating: 9.0,
      maturityRating: null,
      genres: ['Drama'],
      releaseYear: 2022,
    })],
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
        Id: 'episode:tmdb:123:2:5',
        Type: 'Episode',
        SeriesId: '123',
        ParentIndexNumber: 2,
        IndexNumber: 5,
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
  assert.equal(enriched[0]?.mediaItem.Id, 'episode:tmdb:123:2:5');
  assert.equal(enriched[0]?.mediaItem.Type, 'Episode');
  assert.equal(enriched[0]?.mediaItem.SeriesName, 'Parent Show Title');
  assert.equal(enriched[0]?.mediaItem.Name, 'Parent Show Title');
  assert.equal(enriched[0]?.mediaItem.SeriesId, '123');
  assert.equal(enriched[0]?.mediaItem.ParentIndexNumber, 2);
  assert.equal(enriched[0]?.mediaItem.IndexNumber, 5);
  assert.ok(enriched[0]?.mediaItem.ImageTags.Thumb);
  assert.ok(enriched[0]?.mediaItem.ImageTags.Backdrop.length > 0);
  assert.equal(enriched[0]?.mediaItem.EpisodeTitle, 'Episode 5 Title');
});

test('enrichContinueWatchingItems drops episode items missing parent show record', async () => {
  const { WatchMetadataEnrichmentService } = await import('./watch-metadata-enrichment.service.js');
  const cacheRecords = new Map<string, WatchMediaCardCacheRecord>([
    ['episode:tmdb:999:1:1', createCacheRecord({
      mediaKey: 'episode:tmdb:999:1:1',
      mediaType: 'episode',
      titleProviderId: '999',
      titleMediaType: 'show',
      title: 'Orphan Episode',
      posterUrl: null,
      backdropUrl: null,
      stillUrl: null,
      logoUrl: null,
      releaseYear: null,
      rating: null,
      maturityRating: null,
      genres: [],
    })],
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
        Id: 'episode:tmdb:999:1:1',
        Type: 'Episode',
        SeriesId: '999',
        ParentIndexNumber: 1,
        IndexNumber: 1,
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
    ['show:tmdb:789', createCacheRecord({
      mediaKey: 'show:tmdb:789',
      mediaType: 'show',
      titleProviderId: '789',
      titleMediaType: 'show',
      title: 'Cached Show Title',
      subtitle: 'Season 1',
      posterUrl: 'https://cache.test/show-poster.jpg',
      backdropUrl: 'https://cache.test/show-backdrop.jpg',
      logoUrl: null,
      releaseYear: 2022,
      rating: 9.1,
      maturityRating: null,
      genres: ['Drama'],
    })],
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
        Id: 'show:tmdb:789',
        Type: 'Series',
        Name: 'Fallback Show Title',
        ImageTags: {
          Primary: imageSet('https://media.test/show-poster.jpg'),
          Backdrop: [imageSet('https://media.test/backdrop.jpg')],
          Logo: null,
          Thumb: null,
          Screenshot: [],
        },
        ProductionYear: 2021,
        CommunityRating: 8.0,
        ProviderIds: { Tmdb: '789', Imdb: null, Tvdb: null },
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
  assert.equal(enriched[0]?.mediaItem.Name, 'Cached Show Title');
  assert.deepEqual(enriched[0]?.mediaItem.ImageTags.Primary, imageSet('https://cache.test/show-poster.jpg'));
  assert.equal(enriched[0]?.mediaItem.CommunityRating, 9.1);
  assert.deepEqual(enriched[0]?.mediaItem.Genres, ['Drama']);
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
        Id: 'movie:tmdb:999',
        Type: 'Movie',
        Name: 'Uncached Movie',
        ImageTags: {
          Primary: imageSet('https://media.test/uncached.jpg'),
          Backdrop: [imageSet('https://media.test/backdrop.jpg')],
          Logo: null,
          Thumb: null,
          Screenshot: [],
        },
        ProductionYear: 2020,
        CommunityRating: 6.5,
        ProviderIds: { Tmdb: '999', Imdb: null, Tvdb: null },
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
  assert.equal(enriched[0]?.mediaItem.Name, 'Uncached Movie');
  assert.deepEqual(enriched[0]?.mediaItem.ImageTags.Primary, imageSet('https://media.test/uncached.jpg'));
  assert.equal(enriched[0]?.rating.value, 8);
});

test('enrichRegularMediaItems deduplicates media keys', async () => {
  const { WatchMetadataEnrichmentService } = await import('./watch-metadata-enrichment.service.js');
  let receivedMediaKeys: string[] = [];

  const cacheRecords = new Map<string, WatchMediaCardCacheRecord>([
    ['movie:tmdb:111', createCacheRecord({
      mediaKey: 'movie:tmdb:111',
      titleProviderId: '111',
      title: 'Duplicate Movie',
      posterUrl: 'https://cache.test/dup.jpg',
      backdropUrl: null,
      logoUrl: null,
      releaseYear: 2023,
      rating: 7.5,
      maturityRating: null,
      genres: ['Comedy'],
    })],
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
        Id: 'movie:tmdb:111',
        Type: 'Movie',
        Name: 'Fallback',
        ImageTags: {
          Primary: imageSet('https://media.test/dup.jpg'),
          Backdrop: [imageSet('https://media.test/backdrop.jpg')],
          Logo: null,
          Thumb: null,
          Screenshot: [],
        },
        ProductionYear: 2022,
        CommunityRating: 7.0,
        ProviderIds: { Tmdb: '111', Imdb: null, Tvdb: null },
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
        Id: 'movie:tmdb:111',
        Type: 'Movie',
        Name: 'Fallback',
        ImageTags: {
          Primary: imageSet('https://media.test/dup.jpg'),
          Backdrop: [imageSet('https://media.test/backdrop.jpg')],
          Logo: null,
          Thumb: null,
          Screenshot: [],
        },
        ProductionYear: 2022,
        CommunityRating: 7.0,
        ProviderIds: { Tmdb: '111', Imdb: null, Tvdb: null },
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
