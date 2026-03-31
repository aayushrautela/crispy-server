import { parseMediaKey, type SupportedProvider } from '../identity/media-key.js';
import type { MetadataCardView, MetadataTitleMediaType } from '../metadata/metadata.types.js';
import type {
  ContinueWatchingProductItem,
  DetailsTarget,
  EpisodeContext,
  PlaybackTarget,
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
  const base = mapStoredRow(row);
  if (!base?.playbackTarget?.contentId) {
    return null;
  }

  return {
    ...base,
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
  const base = mapStoredRow(row);
  if (!base) {
    return null;
  }

  return {
    ...base,
    watchedAt: row.watchedAt,
    origins: deriveWatchOrigins(row.payload),
  };
}

export function mapWatchlistRowToProduct(row: RawWatchlistRow): WatchlistProductItem | null {
  const base = mapStoredRow(row);
  if (!base) {
    return null;
  }

  return {
    ...base,
    addedAt: row.addedAt,
    origins: deriveWatchOrigins(row.payload),
  };
}

export function mapRatingRowToProduct(row: RawRatingRow): RatingProductItem | null {
  const base = mapStoredRow(row);
  if (!base) {
    return null;
  }

  return {
    ...base,
    rating: {
      value: row.rating,
      ratedAt: row.ratedAt,
    },
    origins: deriveWatchOrigins(row.payload),
  };
}

function mapStoredRow(row: StoredWatchRow): {
  media: MetadataCardView;
  detailsTarget: DetailsTarget;
  playbackTarget: PlaybackTarget | null;
  episodeContext: EpisodeContext;
} | null {
  const detailsTarget = mapDetailsTarget(row);
  if (!detailsTarget) {
    return null;
  }

  const media = mapDetailsMedia(row, detailsTarget);
  if (!media) {
    return null;
  }

  const playbackTarget = mapPlaybackTarget(row);
  const episodeContext = mapEpisodeContext(row);

  return {
    media,
    detailsTarget,
    playbackTarget,
    episodeContext,
  };
}

function mapDetailsTarget(row: StoredWatchRow): DetailsTarget | null {
  if (!row.detailsTitleId || !row.detailsTitleMediaType) {
    return null;
  }

  return {
    kind: 'title',
    titleId: row.detailsTitleId,
    titleMediaType: row.detailsTitleMediaType,
    highlightEpisodeId: row.highlightEpisodeId,
  };
}

function mapPlaybackTarget(row: StoredWatchRow): PlaybackTarget | null {
  if (!row.playbackMediaType) {
    return null;
  }

  if (row.playbackMediaType === 'movie' && !row.playbackContentId) {
    return null;
  }

  return {
    contentId: row.playbackContentId,
    mediaType: row.playbackMediaType,
    provider: asSupportedProvider(row.playbackProvider),
    providerId: row.playbackProviderId,
    parentProvider: asSupportedProvider(row.playbackParentProvider),
    parentProviderId: row.playbackParentProviderId,
    seasonNumber: row.playbackSeasonNumber,
    episodeNumber: row.playbackEpisodeNumber,
    absoluteEpisodeNumber: row.playbackAbsoluteEpisodeNumber,
  };
}

function mapEpisodeContext(row: StoredWatchRow): EpisodeContext {
  if (!row.highlightEpisodeId) {
    return null;
  }

  return {
    episodeId: row.highlightEpisodeId,
    seasonNumber: row.playbackSeasonNumber,
    episodeNumber: row.playbackEpisodeNumber,
    absoluteEpisodeNumber: row.playbackAbsoluteEpisodeNumber,
    title: row.episodeTitle,
    airDate: row.episodeAirDate,
    runtimeMinutes: row.episodeRuntimeMinutes,
    stillUrl: row.episodeStillUrl,
    overview: row.episodeOverview,
  };
}

function mapDetailsMedia(row: StoredWatchRow, detailsTarget: DetailsTarget): MetadataCardView | null {
  const parsed = parseMediaKey(row.mediaKey);
  const provider = resolveTitleProvider(row, parsed);
  const providerId = resolveTitleProviderId(row, parsed);
  if (!provider || !providerId) {
    return null;
  }

  const tmdbId = row.detailsTmdbId;
  const showTmdbId = row.detailsShowTmdbId ?? (
    detailsTarget.titleMediaType !== 'movie' && provider === 'tmdb' ? tmdbId : null
  );
  const mediaKey = `${detailsTarget.titleMediaType}:${provider}:${providerId}`;

  return {
    id: detailsTarget.titleId,
    mediaKey,
    mediaType: detailsTarget.titleMediaType,
    kind: 'title',
    provider,
    providerId,
    parentMediaType: null,
    parentProvider: null,
    parentProviderId: null,
    tmdbId,
    showTmdbId,
    seasonNumber: null,
    episodeNumber: null,
    absoluteEpisodeNumber: null,
    title: row.detailsTitle,
    subtitle: row.detailsSubtitle,
    summary: row.detailsSummary,
    overview: row.detailsOverview,
    artwork: {
      posterUrl: row.detailsPosterUrl,
      backdropUrl: row.detailsBackdropUrl,
      stillUrl: row.detailsStillUrl,
    },
    images: {
      posterUrl: row.detailsPosterUrl,
      backdropUrl: row.detailsBackdropUrl,
      stillUrl: row.detailsStillUrl,
      logoUrl: null,
    },
    releaseDate: row.detailsReleaseDate,
    releaseYear: row.detailsReleaseYear,
    runtimeMinutes: row.detailsRuntimeMinutes,
    rating: row.detailsRating,
    status: row.detailsStatus,
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

function asSupportedProvider(value: string | null): SupportedProvider | null {
  return value === 'tmdb' || value === 'tvdb' || value === 'kitsu' ? value : null;
}
