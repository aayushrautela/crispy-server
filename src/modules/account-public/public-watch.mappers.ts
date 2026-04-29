import type { PublicMediaItemDto, PublicWatchItemDto, PublicWatchlistItemDto, PublicRatingDto, PublicContinueWatchingItemDto } from '../../http/contracts/account-public.js';
import type { RawWatchHistoryRow, RawWatchlistRow, RawRatingRow, RawContinueWatchingRow } from '../watch/watch-query.service.js';

export function mapPublicMediaItem(row: {
  mediaKey: string;
  mediaType: string;
  title: string | null;
  subtitle: string | null;
  posterUrl: string | null;
  backdropUrl?: string | null;
  detailsReleaseYear?: number | null;
  detailsRuntimeMinutes?: number | null;
  detailsRating?: number | null;
}): PublicMediaItemDto | null {
  if (!row.title || !row.posterUrl) {
    return null;
  }

  return {
    mediaKey: row.mediaKey,
    mediaType: normalizeMediaType(row.mediaType),
    title: row.title,
    subtitle: row.subtitle,
    year: row.detailsReleaseYear ?? null,
    posterUrl: row.posterUrl,
    backdropUrl: row.backdropUrl ?? null,
    runtimeMinutes: row.detailsRuntimeMinutes ?? null,
    rating: row.detailsRating ?? null,
  };
}

export function mapPublicWatchItem(row: RawWatchHistoryRow, profileId: string): PublicWatchItemDto | null {
  const media = mapPublicMediaItem(row);
  if (!media) {
    return null;
  }

  return {
    id: row.id,
    profileId,
    media,
    watchedAt: row.watchedAt,
  };
}

export function mapPublicWatchlistItem(row: RawWatchlistRow, profileId: string): PublicWatchlistItemDto | null {
  const media = mapPublicMediaItem(row);
  if (!media) {
    return null;
  }

  return {
    id: row.id,
    profileId,
    media,
    addedAt: row.addedAt,
  };
}

export function mapPublicRatingItem(row: RawRatingRow, profileId: string): PublicRatingDto | null {
  const media = mapPublicMediaItem(row);
  if (!media) {
    return null;
  }

  return {
    id: row.id,
    profileId,
    media,
    rating: row.rating,
    ratedAt: row.ratedAt,
  };
}

export function mapPublicContinueWatchingItem(row: RawContinueWatchingRow, profileId: string): PublicContinueWatchingItemDto | null {
  const media = mapPublicMediaItem(row);
  if (!media) {
    return null;
  }

  return {
    id: row.id,
    profileId,
    media,
    lastActivityAt: row.lastActivityAt,
    progressSeconds: row.positionSeconds,
    durationSeconds: row.durationSeconds,
    progressPercent: row.progressPercent,
  };
}

function normalizeMediaType(mediaType: string): 'movie' | 'show' | 'season' | 'episode' | 'unknown' {
  if (mediaType === 'movie' || mediaType === 'show' || mediaType === 'season' || mediaType === 'episode') {
    return mediaType;
  }
  return 'unknown';
}
