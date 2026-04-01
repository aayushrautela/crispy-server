import { parseMediaKey, type SupportedProvider } from '../identity/media-key.js';
import type { LandscapeCardView, MetadataTitleMediaType, RegularCardView } from '../metadata/metadata.types.js';
import type {
  ContinueWatchingProductItem,
  RatingProductItem,
  WatchedProductItem,
  WatchlistProductItem,
} from './watch-derived-item.types.js';
import { deriveWatchOrigins } from './watch-origins.js';
import type {
  RawContinueWatchingRow,
  RawRatingRow,
  RawWatchHistoryRow,
  RawWatchlistRow,
} from './watch-query.service.js';

type StoredWatchRow = RawContinueWatchingRow | RawWatchHistoryRow | RawWatchlistRow | RawRatingRow;

export function mapContinueWatchingRowToProduct(row: RawContinueWatchingRow): ContinueWatchingProductItem | null {
  const media = mapLandscapeMedia(row);
  if (!media) {
    return null;
  }

  return {
    media,
    id: row.id,
    progress: {
      positionSeconds: row.positionSeconds,
      durationSeconds: row.durationSeconds,
      progressPercent: row.progressPercent,
      lastPlayedAt: row.lastActivityAt,
    },
    lastActivityAt: row.lastActivityAt,
    origins: deriveWatchOrigins(row.payload),
    dismissible: true,
  };
}

export function mapWatchedRowToProduct(row: RawWatchHistoryRow): WatchedProductItem | null {
  const media = mapRegularMedia(row);
  if (!media) {
    return null;
  }

  return {
    media,
    watchedAt: row.watchedAt,
    origins: deriveWatchOrigins(row.payload),
  };
}

export function mapWatchlistRowToProduct(row: RawWatchlistRow): WatchlistProductItem | null {
  const media = mapRegularMedia(row);
  if (!media) {
    return null;
  }

  return {
    media,
    addedAt: row.addedAt,
    origins: deriveWatchOrigins(row.payload),
  };
}

export function mapRatingRowToProduct(row: RawRatingRow): RatingProductItem | null {
  const media = mapRegularMedia(row);
  if (!media) {
    return null;
  }

  return {
    media,
    rating: {
      value: row.rating,
      ratedAt: row.ratedAt,
    },
    origins: deriveWatchOrigins(row.payload),
  };
}

function mapRegularMedia(row: StoredWatchRow): RegularCardView | null {
  if (!row.title || !row.posterUrl) {
    return null;
  }

  const parsed = parseMediaKey(row.mediaKey);
  const provider = resolveTitleProvider(row, parsed);
  const providerId = resolveTitleProviderId(row, parsed);
  const titleMediaType = resolveTitleMediaType(row, parsed);
  if (!provider || !providerId || !titleMediaType) {
    return null;
  }

  return {
    mediaType: titleMediaType,
    provider,
    providerId,
    title: row.title,
    posterUrl: row.posterUrl,
    releaseYear: row.detailsReleaseYear,
    rating: row.detailsRating,
    genre: null,
    subtitle: row.subtitle,
  };
}

function mapLandscapeMedia(row: RawContinueWatchingRow): LandscapeCardView | null {
  const parsed = parseMediaKey(row.mediaKey);
  const provider = resolveTitleProvider(row, parsed);
  const providerId = resolveTitleProviderId(row, parsed);
  const titleMediaType = resolveTitleMediaType(row, parsed);
  const episodeBackdrop = row.episodeStillUrl ?? row.detailsStillUrl;
  const backdropUrl = episodeBackdrop ?? row.backdropUrl ?? row.posterUrl;
  if (!provider || !providerId || !titleMediaType || !row.title || !row.posterUrl || !backdropUrl) {
    return null;
  }

  return {
    mediaType: titleMediaType,
    provider,
    providerId,
    title: row.title,
    posterUrl: row.posterUrl,
    backdropUrl,
    releaseYear: row.detailsReleaseYear,
    rating: row.detailsRating,
    genre: null,
    seasonNumber: row.playbackSeasonNumber,
    episodeNumber: row.playbackEpisodeNumber,
    episodeTitle: row.episodeTitle,
    airDate: row.episodeAirDate,
    runtimeMinutes: row.episodeRuntimeMinutes ?? row.detailsRuntimeMinutes,
  };
}

function resolveTitleProvider(row: StoredWatchRow, parsed: ReturnType<typeof parseMediaKey>): SupportedProvider | null {
  const direct = asSupportedProvider(row.detailsProvider);
  if (direct) {
    return direct;
  }

  if (parsed.mediaType === 'movie' || parsed.mediaType === 'show' || parsed.mediaType === 'anime') {
    return parsed.provider ?? null;
  }

  return asSupportedProvider(parsed.parentProvider ?? null) ?? asSupportedProvider(row.playbackParentProvider);
}

function resolveTitleProviderId(row: StoredWatchRow, parsed: ReturnType<typeof parseMediaKey>): string | null {
  if (row.detailsProviderId) {
    return row.detailsProviderId;
  }

  if (parsed.mediaType === 'movie' || parsed.mediaType === 'show' || parsed.mediaType === 'anime') {
    return parsed.providerId ?? null;
  }

  return parsed.parentProviderId ?? row.playbackParentProviderId;
}

function resolveTitleMediaType(row: StoredWatchRow, parsed: ReturnType<typeof parseMediaKey>): MetadataTitleMediaType | null {
  if (row.detailsTitleMediaType === 'movie' || row.detailsTitleMediaType === 'show' || row.detailsTitleMediaType === 'anime') {
    return row.detailsTitleMediaType;
  }

  if (parsed.mediaType === 'movie' || parsed.mediaType === 'show' || parsed.mediaType === 'anime') {
    return parsed.mediaType;
  }

  if (parsed.mediaType === 'episode') {
    return parsed.parentProvider === 'kitsu' || row.playbackParentProvider === 'kitsu' ? 'anime' : 'show';
  }

  return null;
}

function asSupportedProvider(value: string | null): SupportedProvider | null {
  return value === 'tmdb' || value === 'tvdb' || value === 'kitsu' ? value : null;
}
