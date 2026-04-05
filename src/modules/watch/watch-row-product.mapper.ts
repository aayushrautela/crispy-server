import { parseMediaKey, type SupportedProvider } from '../identity/media-key.js';
import type { LandscapeCardView, MetadataTitleMediaType, RegularCardView } from '../metadata/metadata-card.types.js';
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

type ContinueWatchingStoredRow = RawContinueWatchingRow;

export type ContinueWatchingRowDiagnostics = {
  provider: SupportedProvider | null;
  providerId: string | null;
  titleMediaType: MetadataTitleMediaType | null;
  backdropUrl: string | null;
  missing: string[];
};

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
  const media = mapRegularStateToProductMedia(row.media);
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
  const media = mapRegularStateToProductMedia(row.media);
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
  const media = mapRegularStateToProductMedia(row.media);
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

export function mapRegularStateToProductMedia(media: RegularCardView | null | undefined): RegularCardView | null {
  if (!media?.title || !media.posterUrl) {
    return null;
  }

  return media;
}

export function diagnoseContinueWatchingRow(row: RawContinueWatchingRow): ContinueWatchingRowDiagnostics {
  const parsed = parseMediaKey(row.mediaKey);
  const provider = resolveTitleProvider(row, parsed);
  const providerId = resolveTitleProviderId(row, parsed);
  const titleMediaType = resolveTitleMediaType(row, parsed);
  const episodeBackdrop = row.episodeStillUrl ?? row.detailsStillUrl;
  const backdropUrl = episodeBackdrop ?? row.backdropUrl ?? row.posterUrl;
  const missing: string[] = [];

  if (!provider) {
    missing.push('provider');
  }
  if (!providerId) {
    missing.push('providerId');
  }
  if (!titleMediaType) {
    missing.push('titleMediaType');
  }
  if (!row.title) {
    missing.push('title');
  }
  if (!row.posterUrl) {
    missing.push('posterUrl');
  }
  if (!backdropUrl) {
    missing.push('backdropUrl');
  }

  return {
    provider,
    providerId,
    titleMediaType,
    backdropUrl,
    missing,
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
    mediaKey: row.mediaKey,
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

function resolveTitleProvider(row: ContinueWatchingStoredRow, parsed: ReturnType<typeof parseMediaKey>): SupportedProvider | null {
  if (parsed.mediaType === 'movie' || parsed.mediaType === 'show' || parsed.mediaType === 'anime') {
    return parsed.provider ?? null;
  }

  return asSupportedProvider(parsed.parentProvider ?? null) ?? asSupportedProvider(row.playbackParentProvider);
}

function resolveTitleProviderId(row: ContinueWatchingStoredRow, parsed: ReturnType<typeof parseMediaKey>): string | null {
  if (parsed.mediaType === 'movie' || parsed.mediaType === 'show' || parsed.mediaType === 'anime') {
    return parsed.providerId ?? null;
  }

  return parsed.parentProviderId ?? row.playbackParentProviderId;
}

function resolveTitleMediaType(row: ContinueWatchingStoredRow, parsed: ReturnType<typeof parseMediaKey>): MetadataTitleMediaType | null {
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
