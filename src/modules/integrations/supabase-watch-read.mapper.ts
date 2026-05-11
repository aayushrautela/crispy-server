import { parseMediaKey } from '../identity/media-key.js';
import type { RegularCardView, LandscapeCardView } from '../metadata/metadata-card.types.js';
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

  return {
    id: titleMediaKey,
    media: landscapeCard(titleMediaKey, row),
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
    media: regularCard(mediaKey, row),
    addedAt: isoValue(row.added_at),
    origins: origins(row),
  };
}

export function mapSupabaseRatingRow(row: SupabaseWatchReadRow): RatingProductItem {
  const mediaKey = stringValue(row.media_key);
  return {
    id: mediaKey,
    media: regularCard(mediaKey, row),
    rating: {
      value: numberValue(row.rating) ?? 0,
      ratedAt: isoValue(row.rated_at),
    },
    origins: origins(row),
  };
}

export function mapSupabaseHistoryRow(row: SupabaseWatchReadRow): HistoryProductItem {
  const mediaKey = stringValue(row.media_key);
  return {
    id: stringValue(row.id) || `${mediaKey}:${isoValue(row.watched_at)}`,
    media: regularCard(mediaKey, row),
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

  return {
    media: regularCard(mediaKey, row),
    progress: progressBps !== null && lastActivityAt
      ? {
          positionSeconds: numberValue(row.position_seconds),
          durationSeconds: numberValue(row.duration_seconds),
          progressPercent: progressBps / 100,
          status: stringValue(row.playback_status) || undefined,
          lastPlayedAt: lastActivityAt,
        }
      : null,
    continueWatching: continueProgressBps !== null && continueLastActivityAt && !row.continue_dismissed_at
      ? {
          id: stringValue(row.continue_title_media_key) || mediaKey,
          positionSeconds: numberValue(row.continue_position_seconds),
          durationSeconds: numberValue(row.continue_duration_seconds),
          progressPercent: continueProgressBps / 100,
          lastActivityAt: continueLastActivityAt,
        }
      : null,
    watched: lastWatchedAt && stringValue(row.watch_state) === 'watched'
      ? { watchedAt: lastWatchedAt }
      : null,
    watchlist: watchlistAddedAt ? { addedAt: watchlistAddedAt } : null,
    rating: rating !== null && ratedAt ? { value: rating, ratedAt } : null,
    watchedEpisodeKeys: [],
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
