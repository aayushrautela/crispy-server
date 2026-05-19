import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';
import type { WatchMediaCardCacheService } from './watch-media-card-cache.service.js';
import type { WatchMediaCardCacheRecord } from './watch-media-card-cache.repo.js';
import type { BaseItemDto } from '../metadata/media-item.types.js';

seedTestEnv();

const movieItemId = '00000000000040008000000000000001';
const showItemId = '00000000000040008000000000000002';
const episodeItemId = '00000000000040008000000000000003';
const orphanEpisodeId = '00000000000040008000000000000004';
const duplicateMovieId = '00000000000040008000000000000005';
const uncachedMovieId = '00000000000040008000000000000006';

const imageSet = (value: string) => ({ small: value, medium: value, large: value });

function createBaseItemDto(overrides: Partial<BaseItemDto> = {}): BaseItemDto {
  return {
    Id: movieItemId,
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
    itemId: movieItemId,
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
    [movieItemId, createCacheRecord({
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

  const items: BaseItemDto[] = [
    {
      ...createBaseItemDto(),
      Id: movieItemId,
      UserData: {
        ItemId: movieItemId,
        IsFavorite: false,
        Played: false,
        PlayCount: 0,
        PlaybackPositionTicks: 3_000_000_000,
        RuntimeTicks: 72_000_000_000,
        PlayedPercentage: 4.17,
        LastPlayedDate: '2026-05-11T10:00:00.000Z',
        Rating: null,
        DismissedFromContinueWatching: false,
      },
    },
  ];

  const enriched = await service.enrichContinueWatchingItems({} as never, items);

  assert.equal(enriched.length, 1);
  assert.equal(enriched[0]?.Name, 'Cached Movie Title');
  assert.deepEqual(enriched[0]?.ImageTags.Primary, imageSet('https://cache.test/poster.jpg'));
  assert.equal(enriched[0]?.ProductionYear, 2024);
  assert.equal(enriched[0]?.CommunityRating, 8.5);
  assert.deepEqual(enriched[0]?.Genres, ['Action']);
  assert.equal(enriched[0]?.RemoteTrailers[0]?.Url, 'https://youtube.test/watch?v=abc');
  assert.equal(enriched[0]?.RemoteTrailers[0]?.ThumbnailUrl, 'https://youtube.test/thumb.jpg');
  assert.equal(enriched[0]?.PosterColor, '#111111');
  assert.equal(enriched[0]?.BackdropColor, '#222222');
  assert.equal(enriched[0]?.RunTimeTicks, null);
});

test('enrichContinueWatchingItems enriches parent title for episode items', async () => {
  const { WatchMetadataEnrichmentService } = await import('./watch-metadata-enrichment.service.js');
  const cacheRecords = new Map<string, WatchMediaCardCacheRecord>([
    [episodeItemId, createCacheRecord({
      itemId: episodeItemId,
      mediaType: 'episode',
      titleProviderId: '123',
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
    [showItemId, createCacheRecord({
      itemId: showItemId,
      mediaType: 'show',
      titleProviderId: '123',
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

  const items: BaseItemDto[] = [
    {
      ...createBaseItemDto({
        Id: episodeItemId,
        Type: 'Episode',
        SeriesId: showItemId,
        ParentIndexNumber: 2,
        IndexNumber: 5,
      }),
      UserData: {
        ItemId: episodeItemId,
        IsFavorite: false,
        Played: false,
        PlayCount: 0,
        PlaybackPositionTicks: 6_000_000_000,
        RuntimeTicks: 18_000_000_000,
        PlayedPercentage: 33.33,
        LastPlayedDate: '2026-05-14T08:00:00.000Z',
        Rating: null,
        DismissedFromContinueWatching: false,
      },
    },
  ];

  const enriched = await service.enrichContinueWatchingItems({} as never, items);

  assert.equal(enriched.length, 1);
  assert.equal(enriched[0]?.Id, episodeItemId);
  assert.equal(enriched[0]?.Type, 'Episode');
  assert.equal(enriched[0]?.SeriesName, 'Parent Show Title');
  assert.equal(enriched[0]?.Name, 'Parent Show Title');
  assert.equal(enriched[0]?.SeriesId, showItemId);
  assert.equal(enriched[0]?.ParentIndexNumber, 2);
  assert.equal(enriched[0]?.IndexNumber, 5);
  assert.ok(enriched[0]?.ImageTags.Thumb);
  assert.ok(enriched[0]?.ImageTags.Backdrop.length > 0);
  assert.equal(enriched[0]?.EpisodeTitle, 'Episode 5 Title');
});

test('enrichContinueWatchingItems drops episode items missing parent show record', async () => {
  const { WatchMetadataEnrichmentService } = await import('./watch-metadata-enrichment.service.js');
  const cacheRecords = new Map<string, WatchMediaCardCacheRecord>([
    [orphanEpisodeId, createCacheRecord({
      itemId: orphanEpisodeId,
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

  const items: BaseItemDto[] = [
    {
      ...createBaseItemDto({
        Id: orphanEpisodeId,
        Type: 'Episode',
        SeriesId: showItemId,
        ParentIndexNumber: 1,
        IndexNumber: 1,
      }),
      UserData: {
        ItemId: orphanEpisodeId,
        IsFavorite: false,
        Played: false,
        PlayCount: 0,
        PlaybackPositionTicks: 1_000_000_000,
        RuntimeTicks: 18_000_000_000,
        PlayedPercentage: 5.56,
        LastPlayedDate: '2026-05-14T10:00:00.000Z',
        Rating: null,
        DismissedFromContinueWatching: false,
      },
    },
  ];

  const enriched = await service.enrichContinueWatchingItems({} as never, items);

  assert.equal(enriched.length, 0);
});

test('enrichRegularMediaItems replaces mediaItem fields for history items', async () => {
  const { WatchMetadataEnrichmentService } = await import('./watch-metadata-enrichment.service.js');
  const cacheRecords = new Map<string, WatchMediaCardCacheRecord>([
    [showItemId, createCacheRecord({
      itemId: showItemId,
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

  const items: BaseItemDto[] = [
    {
      ...createBaseItemDto({
        Id: showItemId,
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
      UserData: null,
    },
  ];

  const enriched = await service.enrichRegularMediaItems({} as never, items);

  assert.equal(enriched.length, 1);
  assert.equal(enriched[0]?.Name, 'Cached Show Title');
  assert.deepEqual(enriched[0]?.ImageTags.Primary, imageSet('https://cache.test/show-poster.jpg'));
  assert.equal(enriched[0]?.CommunityRating, 9.1);
  assert.deepEqual(enriched[0]?.Genres, ['Drama']);
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

  const items: BaseItemDto[] = [
    {
      ...createBaseItemDto({
        Id: uncachedMovieId,
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
      UserData: null,
    },
  ];

  const enriched = await service.enrichRegularMediaItems({} as never, items);

  assert.equal(enriched.length, 1);
  assert.equal(enriched[0]?.Name, 'Uncached Movie');
  assert.deepEqual(enriched[0]?.ImageTags.Primary, imageSet('https://media.test/uncached.jpg'));
});

test('enrichRegularMediaItems deduplicates item ids', async () => {
  const { WatchMetadataEnrichmentService } = await import('./watch-metadata-enrichment.service.js');
  let receivedItemIds: string[] = [];

  const cacheRecords = new Map<string, WatchMediaCardCacheRecord>([
    [duplicateMovieId, createCacheRecord({
      itemId: duplicateMovieId,
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
    listCardCacheRecords: async (_client: unknown, itemIds: string[]) => {
      receivedItemIds = itemIds;
      return cacheRecords;
    },
  } as unknown as WatchMediaCardCacheService;

  const service = new WatchMetadataEnrichmentService(watchMediaCardCacheService, {
    refreshMissingCardsAndReturnRecords: async () => new Map(),
  });

  const items: BaseItemDto[] = [
    {
      ...createBaseItemDto({
        Id: duplicateMovieId,
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
      UserData: null,
    },
    {
      ...createBaseItemDto({
        Id: duplicateMovieId,
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
      UserData: null,
    },
  ];

  await service.enrichRegularMediaItems({} as never, items);

  assert.equal(receivedItemIds.length, 1);
  assert.equal(receivedItemIds[0], duplicateMovieId);
});

test('enrichRegularMediaItems handles empty items array', async () => {
  const { WatchMetadataEnrichmentService } = await import('./watch-metadata-enrichment.service.js');
  const watchMediaCardCacheService = {
    listCardCacheRecords: async () => new Map(),
  } as unknown as WatchMediaCardCacheService;

  const service = new WatchMetadataEnrichmentService(watchMediaCardCacheService, {
    refreshMissingCardsAndReturnRecords: async () => new Map(),
  });

  const enriched = await service.enrichRegularMediaItems<BaseItemDto>({} as never, []);

  assert.equal(enriched.length, 0);
});
