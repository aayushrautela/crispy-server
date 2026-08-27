import { encodePublicItemId } from '../identity/public-item-id.js';
import type { WatchInternalRef } from '../watch/watch-read.types.js';

export type WatchReadRow = Record<string, unknown>;

export function mapContinueWatchingInternalRef(row: WatchReadRow): WatchInternalRef | null {
  const rawPlayableItemId = stringValue(row.playable_item_id) || stringValue(row.title_item_id);
  if (!rawPlayableItemId) return null;
  const itemId = encodePublicItemId(rawPlayableItemId);
  const mediaType = normalizeWatchMediaType(row.media_type, row);
  if (mediaType !== 'movie' && mediaType !== 'episode') return null;
  return {
    itemId,
    mediaType,
    progress: {
      positionSeconds: numberValue(row.position_seconds),
      durationSeconds: numberValue(row.duration_seconds),
      progressBps: numberValue(row.progress_bps),
      played: false,
      playCount: 0,
      isFavorite: false,
      rating: null,
      lastPlayedAt: isoValue(row.last_activity_at),
    },
  };
}

export function mapHistoryInternalRef(row: WatchReadRow): WatchInternalRef {
  return {
    itemId: encodePublicItemId(stringValue(row.item_id)),
    mediaType: normalizeWatchMediaType(row.media_type, row),
    progress: {
      positionSeconds: null,
      durationSeconds: numberValue(row.duration_seconds),
      progressBps: null,
      played: true,
      playCount: 1,
      isFavorite: false,
      rating: null,
      lastPlayedAt: isoValue(row.occurred_at ?? row.watched_at),
    },
  };
}

export function mapWatchStateInternalRef(row: WatchReadRow): WatchInternalRef {
  return {
    itemId: encodePublicItemId(stringValue(row.item_id)),
    mediaType: normalizeWatchMediaType(row.media_type, row),
    progress: {
      positionSeconds: numberValue(row.position_seconds),
      durationSeconds: numberValue(row.duration_seconds),
      progressBps: numberValue(row.progress_bps),
      played: row.played === true,
      playCount: numberValue(row.play_count) ?? 0,
      isFavorite: row.is_favorite === true,
      rating: numberValue(row.rating),
      lastPlayedAt: nullableIsoValue(row.last_played_at),
    },
  };
}

export function mapRatingInternalRef(row: WatchReadRow): WatchInternalRef {
  return {
    itemId: encodePublicItemId(stringValue(row.item_id)),
    mediaType: normalizeWatchMediaType(row.media_type, row),
    progress: {
      positionSeconds: null,
      durationSeconds: null,
      progressBps: null,
      played: false,
      playCount: 0,
      isFavorite: false,
      rating: numberValue(row.rating) ?? 0,
      lastPlayedAt: isoValue(row.rated_at),
    },
  };
}

function normalizeWatchMediaType(value: unknown, row: WatchReadRow): WatchInternalRef['mediaType'] {
  const raw = stringValue(value);
  if (raw === 'episode' || raw === 'season' || raw === 'show' || raw === 'movie') {
    const seasonNumber = numberValue(row.season_number);
    const episodeNumber = numberValue(row.episode_number);
    const isEpisode = raw === 'episode' || (seasonNumber !== null && episodeNumber !== null);
    if (isEpisode) return 'episode';
    if (raw === 'season') return 'season';
    if (raw === 'show') return 'show';
    return 'movie';
  }
  return 'movie';
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
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
