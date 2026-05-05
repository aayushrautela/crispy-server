import { parseMediaKey } from '../identity/media-key.js';
import type { LandscapeCardView, MetadataTitleMediaType, RegularCardView } from '../metadata/metadata-card.types.js';
import type {
  ContinueWatchingProductItem,
  HistoryProductItem,
  RatingProductItem,
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

export function mapHistoryRowToProduct(row: RawWatchHistoryRow): HistoryProductItem | null {
  const media = mapRegularStateToProductMedia(row.media);
  if (!media) {
    return null;
  }

  return {
    id: row.id,
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
    id: row.id,
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
    id: row.id,
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
  const titleMediaType = resolveTitleMediaType(row, parsed);
  const episodeBackdrop = row.episodeStillUrl ?? row.detailsStillUrl;
  const backdropUrl = episodeBackdrop ?? row.backdropUrl ?? row.posterUrl;
  const missing: string[] = [];

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
    titleMediaType,
    backdropUrl,
    missing,
  };
}

function mapLandscapeMedia(row: RawContinueWatchingRow): LandscapeCardView | null {
  const parsed = parseMediaKey(row.mediaKey);
  const titleMediaType = resolveTitleMediaType(row, parsed);
  const episodeBackdrop = row.episodeStillUrl ?? row.detailsStillUrl;
  const backdropUrl = episodeBackdrop ?? row.backdropUrl ?? row.posterUrl;
  if (!titleMediaType || !row.title || !row.posterUrl || !backdropUrl) {
    return null;
  }

  return {
    mediaType: titleMediaType,
    mediaKey: row.mediaKey,
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

function resolveTitleMediaType(row: ContinueWatchingStoredRow, parsed: ReturnType<typeof parseMediaKey>): MetadataTitleMediaType | null {
  if (row.detailsTitleMediaType === 'movie' || row.detailsTitleMediaType === 'show') {
    return row.detailsTitleMediaType;
  }

  if (parsed.mediaType === 'movie' || parsed.mediaType === 'show') {
    return parsed.mediaType;
  }

  if (parsed.mediaType === 'episode') {
    return 'show';
  }

  return null;
}
