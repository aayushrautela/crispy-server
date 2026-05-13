import { parseMediaKey } from '../identity/media-key.js';
import { watchCacheRecordToMediaItem } from '../metadata/media-item.mapper.js';
import type { MediaItem } from '../metadata/media-item.types.js';
import type {
  ContinueWatchingProductItem,
  HistoryProductItem,
  RatingProductItem,
  WatchlistProductItem,
} from '../watch/watch-derived-item.types.js';
import type { WatchStateResponse } from '../watch/watch-read.types.js';

export type SupabaseWatchReadRow = Record<string, unknown>;

export function mapSupabaseContinueWatchingRow(row: SupabaseWatchReadRow): ContinueWatchingProductItem {
  const titleMediaKey = stringValue(row.title_media_key);
  const playableMediaKey = stringValue(row.playable_media_key) || titleMediaKey;
  const progressBps = numberValue(row.progress_bps) ?? 0;
  const lastActivityAt = isoValue(row.last_activity_at);
  const mediaItem = mediaItemFromRow(titleMediaKey, row, {
    mediaKey: playableMediaKey,
    backdropUrl: nullableStringValue(row.backdrop_url),
    seasonNumber: numberValue(row.season_number),
    episodeNumber: numberValue(row.episode_number),
    episodeTitle: nullableStringValue(row.episode_title),
    runtimeMinutes: numberValue(row.runtime_minutes),
  });

  return {
    id: titleMediaKey,
    kind: 'continue_watching',
    mediaItem,
    context: {
      id: titleMediaKey,
      progress: {
        positionSeconds: numberValue(row.position_seconds),
        durationSeconds: numberValue(row.duration_seconds),
        progressPercent: progressBps / 100,
        status: 'in_progress',
        lastPlayedAt: lastActivityAt,
      },
      lastActivityAt,
      origins: origins(row),
      dismissible: true,
    },
    presentation: { preferredSize: 'wide', sectionId: null, sectionTitle: null },
    progress: {
      positionSeconds: numberValue(row.position_seconds),
      durationSeconds: numberValue(row.duration_seconds),
      progressPercent: progressBps / 100,
      status: 'in_progress',
      lastPlayedAt: lastActivityAt,
    },
    lastActivityAt,
    origins: origins(row),
    dismissible: true,
  };
}

export function mapSupabaseListItemRow(row: SupabaseWatchReadRow): WatchlistProductItem {
  const mediaKey = stringValue(row.media_key);
  return {
    id: mediaKey,
    kind: 'watchlist',
    mediaItem: mediaItemFromRow(mediaKey, row),
    context: {
      id: mediaKey,
      addedAt: isoValue(row.added_at),
      origins: origins(row),
    },
    presentation: { preferredSize: 'poster', sectionId: null, sectionTitle: null },
    addedAt: isoValue(row.added_at),
    origins: origins(row),
  };
}

export function mapSupabaseRatingRow(row: SupabaseWatchReadRow): RatingProductItem {
  const mediaKey = stringValue(row.media_key);
  const rating = {
    value: numberValue(row.rating) ?? 0,
    ratedAt: isoValue(row.rated_at),
  };
  return {
    id: mediaKey,
    kind: 'rating',
    mediaItem: mediaItemFromRow(mediaKey, row),
    context: {
      id: mediaKey,
      rating,
      origins: origins(row),
    },
    presentation: { preferredSize: 'poster', sectionId: null, sectionTitle: null },
    rating,
    origins: origins(row),
  };
}

export function mapSupabaseHistoryRow(row: SupabaseWatchReadRow): HistoryProductItem {
  const mediaKey = stringValue(row.media_key);
  return {
    id: stringValue(row.id) || `${mediaKey}:${isoValue(row.watched_at)}`,
    kind: 'watch_history',
    mediaItem: mediaItemFromRow(mediaKey, row),
    context: {
      id: stringValue(row.id) || `${mediaKey}:${isoValue(row.watched_at)}`,
      watchedAt: isoValue(row.watched_at),
      origins: origins(row),
    },
    presentation: { preferredSize: 'poster', sectionId: null, sectionTitle: null },
    watchedAt: isoValue(row.watched_at),
    origins: origins(row),
  };
}

export function mapSupabaseWatchStateRow(row: SupabaseWatchReadRow): WatchStateResponse {
  const mediaKey = stringValue(row.media_key);
  const progressBps = numberValue(row.progress_bps);
  const continueProgressBps = numberValue(row.continue_progress_bps);
  const lastActivityAt = nullableIsoValue(row.last_activity_at);
  const continueLastActivityAt = nullableIsoValue(row.continue_last_activity_at);
  const lastWatchedAt = nullableIsoValue(row.last_watched_at) ?? nullableIsoValue(row.completed_at);
  const watchlistAddedAt = nullableIsoValue(row.watchlist_added_at);
  const rating = numberValue(row.rating);
  const ratedAt = nullableIsoValue(row.rated_at);
  const progress = progressBps !== null && lastActivityAt
    ? {
        positionSeconds: numberValue(row.position_seconds),
        durationSeconds: numberValue(row.duration_seconds),
        progressPercent: progressBps / 100,
        status: stringValue(row.playback_status) || undefined,
        lastPlayedAt: lastActivityAt,
      }
    : null;
  const continueWatching = continueProgressBps !== null && continueLastActivityAt && !row.continue_dismissed_at
    ? {
        id: stringValue(row.continue_title_media_key) || mediaKey,
        positionSeconds: numberValue(row.continue_position_seconds),
        durationSeconds: numberValue(row.continue_duration_seconds),
        progressPercent: continueProgressBps / 100,
        lastActivityAt: continueLastActivityAt,
      }
    : null;
  const watched = lastWatchedAt && stringValue(row.watch_state) === 'watched'
    ? { watchedAt: lastWatchedAt }
    : null;
  const watchlist = watchlistAddedAt ? { addedAt: watchlistAddedAt } : null;
  const ratingState = rating !== null && ratedAt ? { value: rating, ratedAt } : null;
  const watchedEpisodeKeys: string[] = [];

  return {
    kind: 'watch_state',
    mediaItem: mediaItemFromRow(mediaKey, row),
    context: {
      progress,
      continueWatching,
      watched,
      watchlist,
      rating: ratingState,
      watchedEpisodeKeys,
    },
    presentation: null,
    progress,
    continueWatching,
    watched,
    watchlist,
    rating: ratingState,
    watchedEpisodeKeys,
  };
}

function mediaItemFromRow(mediaKey: string, row: SupabaseWatchReadRow, overrides: Partial<MediaItem> = {}): MediaItem {
  const parsed = parseMediaKey(mediaKey);
  return watchCacheRecordToMediaItem({
    mediaKey,
    mediaType: parsed.mediaType,
    titleProvider: 'tmdb',
    titleProviderId: String(parsed.tmdbId ?? parsed.showTmdbId ?? mediaKey),
    titleMediaType: parsed.mediaType === 'episode' || parsed.mediaType === 'season' ? 'show' : parsed.mediaType,
    title: stringValue(row.title) || mediaKey,
    subtitle: nullableStringValue(row.subtitle),
    posterUrl: nullableStringValue(row.poster_url),
    backdropUrl: nullableStringValue(row.backdrop_url),
    releaseYear: numberValue(row.release_year),
    rating: numberValue(row.metadata_rating),
    logoUrl: null,
    maturityRating: null,
  }, overrides);
}

function origins(row: SupabaseWatchReadRow): string[] {
  const sourceProvider = nullableStringValue(row.source_provider);
  if (sourceProvider) {
    return [sourceProvider];
  }
  const sourceKind = nullableStringValue(row.source_kind);
  return sourceKind ? [sourceKind] : [];
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
}

function nullableStringValue(value: unknown): string | null {
  const normalized = stringValue(value);
  return normalized || null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isoValue(value: unknown): string {
  return nullableIsoValue(value) ?? new Date(0).toISOString();
}

function nullableIsoValue(value: unknown): string | null {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string' && value.trim()) {
    return value;
  }
  return null;
}
