import { parseMediaKey } from '../identity/media-key.js';
import type { RegularCardView, LandscapeCardView } from '../metadata/metadata-card.types.js';
import { regularCardToMediaItem } from '../metadata/media-item.mapper.js';
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

  const media = landscapeCard(titleMediaKey, row);
  const mediaItem = regularCardToMediaItem({
    mediaType: media.mediaType,
    mediaKey: media.mediaKey,
    title: media.title,
    posterUrl: media.posterUrl,
    releaseYear: media.releaseYear,
    rating: media.rating,
    genre: media.genre,
    subtitle: null,
  });
  return {
    id: titleMediaKey,
    media,
    kind: 'continue_watching',
    mediaItem: {
      ...mediaItem,
      backdropUrl: media.backdropUrl || null,
      seasonNumber: media.seasonNumber,
      episodeNumber: media.episodeNumber,
      episodeTitle: media.episodeTitle,
      airDate: media.airDate,
      runtimeMinutes: media.runtimeMinutes,
    },
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
  const media = regularCard(mediaKey, row);
  return {
    id: mediaKey,
    media,
    kind: 'watchlist',
    mediaItem: regularCardToMediaItem(media),
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
  const media = regularCard(mediaKey, row);
  const rating = {
    value: numberValue(row.rating) ?? 0,
    ratedAt: isoValue(row.rated_at),
  };
  return {
    id: mediaKey,
    media,
    kind: 'rating',
    mediaItem: regularCardToMediaItem(media),
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
  const media = regularCard(mediaKey, row);
  return {
    id: stringValue(row.id) || `${mediaKey}:${isoValue(row.watched_at)}`,
    media,
    kind: 'watch_history',
    mediaItem: regularCardToMediaItem(media),
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

  const media = regularCard(mediaKey, row);
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
    media,
    kind: 'watch_state',
    mediaItem: regularCardToMediaItem(media),
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

function regularCard(mediaKey: string, row: SupabaseWatchReadRow): RegularCardView {
  const parsed = parseMediaKey(mediaKey);
  const mediaType = parsed.mediaType === 'episode' ? 'episode' : parsed.mediaType === 'season' ? 'show' : parsed.mediaType;
  return {
    mediaType,
    mediaKey,
    title: stringValue(row.title) || mediaKey,
    posterUrl: stringValue(row.poster_url),
    releaseYear: numberValue(row.release_year),
    rating: numberValue(row.metadata_rating),
    genre: null,
    subtitle: nullableStringValue(row.subtitle),
  };
}

function landscapeCard(mediaKey: string, row: SupabaseWatchReadRow): LandscapeCardView {
  const parsed = parseMediaKey(mediaKey);
  const mediaType = parsed.mediaType === 'movie' ? 'movie' : 'show';
  return {
    mediaType,
    mediaKey,
    title: stringValue(row.title) || mediaKey,
    posterUrl: stringValue(row.poster_url),
    backdropUrl: stringValue(row.backdrop_url) || stringValue(row.poster_url),
    releaseYear: numberValue(row.release_year),
    rating: numberValue(row.metadata_rating),
    genre: null,
    seasonNumber: numberValue(row.season_number),
    episodeNumber: numberValue(row.episode_number),
    episodeTitle: nullableStringValue(row.episode_title),
    airDate: null,
    runtimeMinutes: numberValue(row.runtime_minutes),
  };
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
