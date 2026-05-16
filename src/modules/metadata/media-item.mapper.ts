import type { MetadataCardView } from './metadata-card.types.js';
import type { MetadataView } from './metadata-detail.types.js';
import type { MediaItem, MediaItemType, MediaItemDto, MediaImageTags, ParentMediaImageTags, ProviderIds, ResponsiveImageSet } from './media-item.types.js';
import type { WatchMediaCardCacheRecord } from '../watch/watch-media-card-cache.repo.js';
import { buildResponsiveImageSet, emptyResponsiveImageSet } from './metadata-builder.shared.js';

const emptyExternalIds = {
  tmdb: null,
  imdb: null,
  tvdb: null,
};

export function metadataCardToMediaItem(card: MetadataCardView, overrides: Partial<MediaItem> = {}): MediaItem {
  const item: MediaItem = {
    mediaKey: card.mediaKey,
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
    showTmdbId: card.showTmdbId,
    seasonNumber: card.seasonNumber,
    episodeNumber: card.episodeNumber,
    absoluteEpisodeNumber: card.absoluteEpisodeNumber,
    episodeTitle: card.mediaType === 'episode' ? card.title : null,
    airDate: card.mediaType === 'episode' ? card.releaseDate : null,
    badges: [],
  };

  return applyOverrides(item, overrides);
}

export function metadataViewToMediaItem(view: MetadataView, overrides: Partial<MediaItem> = {}): MediaItem {
  const item = metadataCardToMediaItem(view, {
    maturityRating: view.certification,
    certification: view.certification,
    externalIds: view.externalIds,
    ...overrides,
  });

  return item;
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

export function mediaItemToMediaItemDto(item: MediaItem): MediaItemDto {
  return {
    id: item.mediaKey,
    mediaKey: item.mediaKey,
    type: item.mediaType === 'show' ? 'Series' : item.mediaType === 'movie' ? 'Movie' : item.mediaType === 'season' ? 'Season' : item.mediaType === 'episode' ? 'Episode' : 'Unknown',
    name: item.title,
    originalTitle: item.originalTitle,
    overview: item.overview,
    tagline: null,
    productionYear: item.releaseYear,
    premiereDate: item.releaseDate,
    communityRating: item.rating,
    officialRating: item.maturityRating,
    certification: item.certification,
    genres: item.genres,
    runTimeSeconds: item.runtimeMinutes !== null ? item.runtimeMinutes * 60 : null,
    status: item.status,
    providerIds: {
      tmdb: providerIdsNumber(item.externalIds.tmdb),
      imdb: item.externalIds.imdb,
      tvdb: providerIdsNumber(item.externalIds.tvdb),
    },
    imageTags: {
      primary: singleOrEmpty(item.images.poster),
      backdrop: [item.images.backdrop],
      logo: singleOrEmpty(item.images.logo),
      thumb: singleOrEmpty(item.images.still),
      screenshot: [],
    },
    parentImageTags: null,
    seriesId: item.showTmdbId !== null ? String(item.showTmdbId) : null,
    seriesName: item.parent?.mediaType === 'show' ? item.parent.title : null,
    seasonId: null,
    seasonName: null,
    parentIndexNumber: item.seasonNumber,
    indexNumber: item.episodeNumber,
    absoluteIndexNumber: item.absoluteEpisodeNumber,
    episodeTitle: item.episodeTitle,
    airDate: item.airDate,
    trailerUrl: item.trailerUrl,
    trailerThumbnailUrl: item.trailerThumbnailUrl,
    posterColor: item.posterColor,
    backdropColor: item.backdropColor,
    userData: null,
  };
}

export function watchCacheRecordToMediaItemDto(record: WatchMediaCardCacheRecord, overrides: Partial<MediaItemDto> = {}): MediaItemDto {
  const still = record.stillUrl
    ? buildResponsiveImageSet(record.stillUrl, { small: 'w185', medium: 'w300', large: 'original' })
    : emptyResponsiveImageSet();

  const thumb: ResponsiveImageSet | null = singleOrEmpty(still);
  const poster = buildResponsiveImageSet(record.posterUrl, { small: 'w342', medium: 'w500', large: 'w780' });
  const backdrop = buildResponsiveImageSet(record.backdropUrl, { small: 'w300', medium: 'w780', large: 'w1280' });
  const logo = buildResponsiveImageSet(record.logoUrl, { small: 'w185', medium: 'w300', large: 'w500' });

  const item: MediaItemDto = {
    id: record.mediaKey,
    mediaKey: record.mediaKey,
    type: record.mediaType === 'show' ? 'Series' : record.mediaType === 'movie' ? 'Movie' : record.mediaType === 'season' ? 'Season' : record.mediaType === 'episode' ? 'Episode' : 'Unknown',
    name: record.title,
    originalTitle: null,
    overview: null,
    tagline: null,
    productionYear: record.releaseYear,
    premiereDate: null,
    communityRating: record.rating,
    officialRating: record.maturityRating,
    certification: record.maturityRating,
    genres: record.genres,
    runTimeSeconds: null,
    status: null,
    providerIds: {
      tmdb: record.titleProviderId ?? null,
      imdb: null,
      tvdb: null,
    },
    imageTags: {
      primary: singleOrEmpty(poster),
      backdrop: thumb?.small ? [thumb, backdrop] : [backdrop],
      logo: singleOrEmpty(logo),
      thumb,
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
    trailerUrl: record.trailerUrl,
    trailerThumbnailUrl: record.trailerThumbnailUrl,
    posterColor: record.posterColor,
    backdropColor: record.backdropColor,
    userData: null,
  };

  return applyDtoOverrides(item, overrides);
}

function applyDtoOverrides(item: MediaItemDto, overrides: Partial<MediaItemDto>): MediaItemDto {
  return {
    ...item,
    ...overrides,
    imageTags: overrides.imageTags ?? item.imageTags,
    providerIds: overrides.providerIds ?? item.providerIds,
    parentImageTags: overrides.parentImageTags === undefined ? item.parentImageTags : overrides.parentImageTags,
  } as MediaItemDto;
}
