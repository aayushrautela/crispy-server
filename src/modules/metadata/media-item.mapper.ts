import type { MetadataCardView } from './metadata-card.types.js';
import type { MetadataView } from './metadata-detail.types.js';
import type { MediaItem, MediaItemType } from './media-item.types.js';
import type { WatchMediaCardCacheRecord } from '../watch/watch-media-card-cache.repo.js';

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
    posterUrl: card.images.posterUrl ?? card.artwork.posterUrl,
    backdropUrl: card.images.backdropUrl ?? card.artwork.backdropUrl,
    logoUrl: card.images.logoUrl,
    stillUrl: card.images.stillUrl ?? card.artwork.stillUrl,
    releaseDate: card.releaseDate,
    releaseYear: card.releaseYear,
    rating: card.rating,
    genres: [],
    runtimeMinutes: card.runtimeMinutes,
    status: card.status,
    maturityRating: card.maturityRating,
    certification: card.maturityRating,
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
  };

  return applyOverrides(item, overrides);
}

export function metadataViewToMediaItem(view: MetadataView, overrides: Partial<MediaItem> = {}): MediaItem {
  const item = metadataCardToMediaItem(view, {
    maturityRating: view.certification,
    certification: view.certification,
    genres: view.genres,
    externalIds: view.externalIds,
    ...overrides,
  });

  return item;
}

export function watchCacheRecordToMediaItem(record: WatchMediaCardCacheRecord, overrides: Partial<MediaItem> = {}): MediaItem {
  return applyOverrides({
    mediaKey: record.mediaKey,
    mediaType: toMediaItemType(record.mediaType),
    title: record.title,
    originalTitle: null,
    subtitle: record.subtitle,
    overview: null,
    posterUrl: record.posterUrl ?? null,
    backdropUrl: record.backdropUrl,
    logoUrl: record.logoUrl,
    stillUrl: null,
    releaseDate: null,
    releaseYear: record.releaseYear,
    rating: record.rating,
    genres: [],
    runtimeMinutes: null,
    status: null,
    maturityRating: record.maturityRating,
    certification: record.maturityRating,
    externalIds: emptyExternalIds,
    parent: null,
    showTmdbId: null,
    seasonNumber: null,
    episodeNumber: null,
    absoluteEpisodeNumber: null,
    episodeTitle: null,
    airDate: null,
  }, overrides);
}

function applyOverrides(item: MediaItem, overrides: Partial<MediaItem>): MediaItem {
  return {
    ...item,
    ...overrides,
    externalIds: overrides.externalIds ?? item.externalIds,
    genres: overrides.genres ?? item.genres,
    parent: overrides.parent === undefined ? item.parent : overrides.parent,
  };
}

function toMediaItemType(mediaType: string): MediaItemType {
  if (mediaType === 'movie' || mediaType === 'show' || mediaType === 'season' || mediaType === 'episode') {
    return mediaType;
  }

  return 'unknown';
}
