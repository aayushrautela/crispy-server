import type { MetadataCardView } from './metadata-card.types.js';

import type { BaseItemDto, BaseItemImageTags, MediaItem, MediaItemType, ParentBaseItemImageTags, ProviderIdsDto, ResponsiveImageSet } from './media-item.types.js';
import type { WatchMediaCardCacheRecord } from '../watch/watch-media-card-cache.repo.js';
import { buildResponsiveImageSet, emptyResponsiveImageSet } from './metadata-builder.shared.js';

const TICKS_PER_SECOND = 10_000_000;

const emptyExternalIds = {
  tmdb: null,
  imdb: null,
  tvdb: null,
};

export function secondsToTicks(seconds: number | null): number | null {
  return seconds !== null ? Math.round(seconds * TICKS_PER_SECOND) : null;
}

export function metadataCardToMediaItem(card: MetadataCardView, overrides: Partial<MediaItem> = {}): MediaItem {
  const itemId = overrides.itemId ?? card.itemId;
  if (!itemId) {
    throw new Error('Metadata card is missing itemId.');
  }

  const item: MediaItem = {
    itemId,
    mediaType: toMediaItemType(card.mediaType),
    title: card.title ?? 'Untitled',
    originalTitle: null,
    subtitle: card.subtitle,
    overview: card.overview ?? card.summary,
    images: card.images,
    releaseDate: card.releaseDate,
    releaseYear: card.releaseYear,
    rating: card.rating,
    genres: card.genres,
    runtimeMinutes: card.runtimeMinutes,
    status: card.status,
    maturityRating: card.maturityRating,
    certification: card.maturityRating,
    trailerUrl: card.trailerUrl,
    trailerThumbnailUrl: card.trailerThumbnailUrl,
    posterColor: card.posterColor,
    backdropColor: card.backdropColor,
    externalIds: {
      ...emptyExternalIds,
      tmdb: card.tmdbId,
    },
    parent: null,
    seriesItemId: overrides.seriesItemId === undefined ? card.seriesItemId : overrides.seriesItemId,
    seasonItemId: overrides.seasonItemId === undefined ? card.seasonItemId : overrides.seasonItemId,
    seasonNumber: card.seasonNumber,
    episodeNumber: card.episodeNumber,
    absoluteEpisodeNumber: card.absoluteEpisodeNumber,
    episodeTitle: card.mediaType === 'episode' ? card.title : null,
    airDate: card.mediaType === 'episode' ? card.releaseDate : null,
    badges: [],
  };

  return applyOverrides(item, overrides);
}


function applyOverrides(item: MediaItem, overrides: Partial<MediaItem>): MediaItem {
  return {
    ...item,
    ...overrides,
    images: overrides.images ?? item.images,
    externalIds: overrides.externalIds ?? item.externalIds,
    genres: overrides.genres ?? item.genres,
    badges: overrides.badges ?? item.badges,
    parent: overrides.parent === undefined ? item.parent : overrides.parent,
  };
}

function toMediaItemType(mediaType: string): MediaItemType {
  if (mediaType === 'movie' || mediaType === 'show' || mediaType === 'season' || mediaType === 'episode') {
    return mediaType;
  }

  return 'unknown';
}

function singleOrEmpty(set: ResponsiveImageSet): ResponsiveImageSet | null {
  return set.small || set.medium || set.large ? set : null;
}

function providerIdsNumber(n: number | null): string | null {
  return n !== null ? String(n) : null;
}

function runtimeMinutesToTicks(minutes: number | null): number | null {
  return minutes !== null ? minutes * 60 * TICKS_PER_SECOND : null;
}

function remoteTrailers(url: string | null, thumbnailUrl: string | null) {
  return url ? [{ Name: null, Url: url, ThumbnailUrl: thumbnailUrl }] : [];
}

export function mediaItemToBaseItemDto(item: MediaItem): BaseItemDto {
  return {
    Id: item.itemId,
    Type: item.mediaType === 'show' ? 'Series' : item.mediaType === 'movie' ? 'Movie' : item.mediaType === 'season' ? 'Season' : item.mediaType === 'episode' ? 'Episode' : 'Unknown',
    Name: item.title,
    OriginalTitle: item.originalTitle,
    Overview: item.overview,
    Taglines: [],
    ProductionYear: item.releaseYear,
    PremiereDate: item.releaseDate,
    CommunityRating: item.rating,
    OfficialRating: item.maturityRating,
    Certification: item.certification,
    Genres: item.genres,
    RunTimeTicks: runtimeMinutesToTicks(item.runtimeMinutes),
    Status: item.status,
    ProviderIds: {
      Tmdb: providerIdsNumber(item.externalIds.tmdb),
      Imdb: item.externalIds.imdb,
      Tvdb: providerIdsNumber(item.externalIds.tvdb),
    },
    ImageTags: {
      Primary: singleOrEmpty(item.images.poster),
      Backdrop: [item.images.backdrop],
      Logo: singleOrEmpty(item.images.logo),
      Thumb: singleOrEmpty(item.images.still),
      Screenshot: [],
    },
    ParentImageTags: null,
    SeriesId: item.seriesItemId,
    SeriesName: item.parent?.mediaType === 'show' ? item.parent.title : null,
    SeasonId: item.seasonItemId,
    SeasonName: null,
    ParentIndexNumber: item.seasonNumber,
    IndexNumber: item.episodeNumber,
    AbsoluteIndexNumber: item.absoluteEpisodeNumber,
    EpisodeTitle: item.episodeTitle,
    AirDate: item.airDate,
    RemoteTrailers: remoteTrailers(item.trailerUrl, item.trailerThumbnailUrl),
    PosterColor: item.posterColor,
    BackdropColor: item.backdropColor,
    UserData: null,
  };
}

type WatchCacheRecordWithItemIds = WatchMediaCardCacheRecord & {
  itemId?: string | null;
  item_id?: string | null;
  seriesItemId?: string | null;
  series_item_id?: string | null;
  seasonItemId?: string | null;
  season_item_id?: string | null;
};

export function watchCacheRecordToBaseItemDto(record: WatchCacheRecordWithItemIds, overrides: Partial<BaseItemDto> = {}): BaseItemDto {
  const still = record.stillUrl
    ? buildResponsiveImageSet(record.stillUrl, { small: 'w300', medium: 'h632', large: 'original' })
    : emptyResponsiveImageSet();

  const thumb: ResponsiveImageSet | null = singleOrEmpty(still);
  const poster = buildResponsiveImageSet(record.posterUrl, { small: 'w342', medium: 'w500', large: 'w780' });
  const backdrop = buildResponsiveImageSet(record.backdropUrl, { small: 'w780', medium: 'w1280', large: 'original' });
  const logo = buildResponsiveImageSet(record.logoUrl, { small: 'w185', medium: 'w500', large: 'original' });

  const itemId = record.itemId ?? record.item_id ?? overrides.Id;
  if (!itemId) {
    throw new Error('Watch media card cache record is missing item_id.');
  }

  const item: BaseItemDto = {
    Id: itemId,
    Type: record.mediaType === 'show' ? 'Series' : record.mediaType === 'movie' ? 'Movie' : record.mediaType === 'season' ? 'Season' : record.mediaType === 'episode' ? 'Episode' : 'Unknown',
    Name: record.title,
    OriginalTitle: null,
    Overview: record.overview,
    Taglines: [],
    ProductionYear: record.releaseYear,
    PremiereDate: record.releaseDate,
    CommunityRating: record.rating,
    OfficialRating: record.maturityRating,
    Certification: record.maturityRating,
    Genres: record.genres,
    RunTimeTicks: runtimeMinutesToTicks(record.runtimeMinutes),
    Status: record.status,
    ProviderIds: {
      Tmdb: record.titleProviderId ?? null,
      Imdb: null,
      Tvdb: null,
    },
    ImageTags: {
      Primary: singleOrEmpty(poster),
      Backdrop: thumb?.small ? [thumb, backdrop] : [backdrop],
      Logo: singleOrEmpty(logo),
      Thumb: thumb,
      Screenshot: [],
    },
    ParentImageTags: null,
    SeriesId: record.seriesItemId ?? record.series_item_id ?? null,
    SeriesName: null,
    SeasonId: record.seasonItemId ?? record.season_item_id ?? null,
    SeasonName: null,
    ParentIndexNumber: null,
    IndexNumber: null,
    AbsoluteIndexNumber: null,
    EpisodeTitle: record.episodeTitle,
    AirDate: record.episodeAirDate,
    RemoteTrailers: remoteTrailers(record.trailerUrl, record.trailerThumbnailUrl),
    PosterColor: record.posterColor,
    BackdropColor: record.backdropColor,
    UserData: null,
  };

  return applyDtoOverrides(item, overrides);
}

function applyDtoOverrides(item: BaseItemDto, overrides: Partial<BaseItemDto>): BaseItemDto {
  return {
    ...item,
    ...overrides,
    ImageTags: overrides.ImageTags ?? item.ImageTags,
    ProviderIds: overrides.ProviderIds ?? item.ProviderIds,
    ParentImageTags: overrides.ParentImageTags === undefined ? item.ParentImageTags : overrides.ParentImageTags,
    Taglines: overrides.Taglines ?? item.Taglines,
    RemoteTrailers: overrides.RemoteTrailers ?? item.RemoteTrailers,
  };
}

export function baseItemId(item: BaseItemDto): string {
  return item.Id;
}

export function baseItemType(item: BaseItemDto) {
  return item.Type;
}

export function baseItemImageTags(item: BaseItemDto): BaseItemImageTags {
  return item.ImageTags;
}

export function baseItemParentImageTags(item: BaseItemDto): ParentBaseItemImageTags | null {
  return item.ParentImageTags;
}

export function baseItemProviderIds(item: BaseItemDto): ProviderIdsDto {
  return item.ProviderIds;
}
