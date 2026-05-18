import { canonicalTitleMediaKey, canonicalTitleMediaType, parseMediaKey } from '../identity/media-key.js';
import { secondsToTicks, watchCacheRecordToBaseItemDto } from '../metadata/media-item.mapper.js';
import type { BaseItemDto, UserItemDataDto } from '../metadata/media-item.types.js';

export type WatchReadRow = Record<string, unknown>;

export function mapContinueWatchingRow(row: WatchReadRow): BaseItemDto {
  const titleMediaKey = stringValue(row.title_media_key);
  const playableMediaKey = stringValue(row.playable_media_key) || titleMediaKey;
  const positionSeconds = numberValue(row.position_seconds);
  const durationSeconds = numberValue(row.duration_seconds);
  const lastActivityAt = isoValue(row.last_activity_at);
  const mediaItem = playableMediaItemDtoFromRow(playableMediaKey, titleMediaKey, row);

  return {
    ...mediaItem,
    UserData: {
      ItemId: playableMediaKey,
      IsFavorite: false,
      Played: false,
      PlayCount: 0,
      PlaybackPositionTicks: secondsToTicks(positionSeconds),
      RuntimeTicks: secondsToTicks(durationSeconds),
      PlayedPercentage: null,
      LastPlayedDate: lastActivityAt,
      Rating: null,
      DismissedFromContinueWatching: false,
    },
  };
}

export function mapListItemRow(row: WatchReadRow): BaseItemDto {
  const mediaKey = stringValue(row.media_key);
  const addedAt = isoValue(row.added_at);
  return {
    ...mediaItemDtoFromRow(mediaKey, row),
    UserData: {
      ItemId: mediaKey,
      IsFavorite: false,
      Played: false,
      PlayCount: 0,
      PlaybackPositionTicks: null,
      RuntimeTicks: null,
      PlayedPercentage: null,
      LastPlayedDate: addedAt,
      Rating: null,
      DismissedFromContinueWatching: false,
    },
  };
}

export function mapRatingRow(row: WatchReadRow): BaseItemDto {
  const mediaKey = stringValue(row.media_key);
  const ratedAt = isoValue(row.rated_at);
  const ratingValue = numberValue(row.rating) ?? 0;
  return {
    ...mediaItemDtoFromRow(mediaKey, row),
    UserData: {
      ItemId: mediaKey,
      IsFavorite: false,
      Played: false,
      PlayCount: 0,
      PlaybackPositionTicks: null,
      RuntimeTicks: null,
      PlayedPercentage: null,
      LastPlayedDate: ratedAt,
      Rating: ratingValue,
      DismissedFromContinueWatching: false,
    },
  };
}

export function mapHistoryRow(row: WatchReadRow): BaseItemDto {
  const mediaKey = stringValue(row.media_key);
  const occurredAt = isoValue(row.occurred_at ?? row.watched_at);
  return {
    ...mediaItemDtoFromRow(mediaKey, row),
    UserData: {
      ItemId: mediaKey,
      IsFavorite: false,
      Played: true,
      PlayCount: 1,
      PlaybackPositionTicks: null,
      RuntimeTicks: null,
      PlayedPercentage: null,
      LastPlayedDate: occurredAt,
      Rating: null,
      DismissedFromContinueWatching: false,
    },
  };
}

export function mapWatchStateRow(row: WatchReadRow): BaseItemDto {
  const mediaKey = stringValue(row.media_key);
  const progressBps = numberValue(row.progress_bps);
  const continueProgressBps = numberValue(row.continue_progress_bps);
  const lastActivityAt = nullableIsoValue(row.last_activity_at);
  const continueLastActivityAt = nullableIsoValue(row.continue_last_activity_at);
  const lastWatchedAt = nullableIsoValue(row.last_watched_at);
  const watchlistAddedAt = nullableIsoValue(row.watchlist_added_at);
  const rating = numberValue(row.rating);
  const ratedAt = nullableIsoValue(row.rated_at);
  const effectiveWatched = row.effective_watched === true;
  const playCount = numberValue(row.play_count) ?? 0;

  const positionSeconds = continueProgressBps !== null
    ? numberValue(row.continue_position_seconds)
    : (progressBps !== null ? numberValue(row.position_seconds) : null);
  const durationSeconds = continueProgressBps !== null
    ? numberValue(row.continue_duration_seconds)
    : (progressBps !== null ? numberValue(row.duration_seconds) : null);
  const lastPlayedDate = effectiveWatched && lastWatchedAt
    ? lastWatchedAt
    : (continueLastActivityAt ?? lastActivityAt);
  const ratingValue = rating !== null && ratedAt ? rating : null;

  const userData: UserItemDataDto = {
    ItemId: mediaKey,
    IsFavorite: false,
    Played: effectiveWatched,
    PlayCount: playCount,
    PlaybackPositionTicks: secondsToTicks(positionSeconds),
    RuntimeTicks: secondsToTicks(durationSeconds),
    PlayedPercentage: continueProgressBps !== null ? continueProgressBps / 100 : (progressBps !== null ? progressBps / 100 : null),
    LastPlayedDate: lastPlayedDate,
    Rating: ratingValue,
    DismissedFromContinueWatching: continueProgressBps !== null && row.continue_dismissed_at !== null,
  };

  return {
    ...mediaItemDtoFromRow(mediaKey, row, { UserData: userData }),
  };
}

function playableMediaItemDtoFromRow(playableMediaKey: string, titleMediaKey: string, row: WatchReadRow): BaseItemDto {
  const parsed = parseMediaKey(playableMediaKey);
  const isEpisode = parsed.mediaType === 'episode';
  const seriesName = isEpisode ? stringValue(row.title) || undefined : undefined;

  return watchCacheRecordToBaseItemDto({
    mediaKey: playableMediaKey,
    mediaType: isEpisode ? 'episode' : parsed.mediaType,
    titleProvider: 'tmdb',
    titleProviderId: isEpisode ? String(parsed.showTmdbId ?? '') : String(parsed.tmdbId ?? ''),
    titleMediaType: canonicalTitleMediaType(parsed),
    title: stringValue(row.title) || playableMediaKey,
    subtitle: nullableStringValue(row.subtitle),
    posterUrl: nullableStringValue(row.poster_url),
    backdropUrl: nullableStringValue(row.backdrop_url),
    stillUrl: nullableStringValue(row.still_url),
    releaseYear: numberValue(row.release_year),
    rating: numberValue(row.metadata_rating),
    logoUrl: null,
    trailerUrl: null,
    trailerThumbnailUrl: null,
    posterColor: null,
    backdropColor: null,
    maturityRating: null,
    genres: [],
    language: 'en',
    overview: null,
    runtimeMinutes: null,
    releaseDate: null,
    status: null,
    episodeTitle: null,
    episodeAirDate: null,
  }, {
    Id: playableMediaKey,
    SeriesName: seriesName ?? null,
    SeasonId: isEpisode ? stringValue(row.season_id) || null : null,
    SeasonName: isEpisode ? nullableStringValue(row.season_name) : null,
    SeriesId: isEpisode ? String(parsed.showTmdbId ?? '') : null,
    ParentIndexNumber: isEpisode ? parsed.seasonNumber : null,
    IndexNumber: isEpisode ? parsed.episodeNumber : null,
    AbsoluteIndexNumber: null,
    EpisodeTitle: isEpisode ? nullableStringValue(row.title) || null : null,
    AirDate: null,
  });
}

function mediaItemDtoFromRow(mediaKey: string, row: WatchReadRow, overrides: Partial<BaseItemDto> = {}): BaseItemDto {
  const parsed = parseMediaKey(canonicalTitleMediaKey(parseMediaKey(mediaKey)));
  return watchCacheRecordToBaseItemDto({
    mediaKey: parsed.mediaKey,
    mediaType: parsed.mediaType,
    titleProvider: 'tmdb',
    titleProviderId: String(parsed.tmdbId ?? parsed.showTmdbId ?? parsed.mediaKey),
    titleMediaType: canonicalTitleMediaType(parsed),
    title: stringValue(row.title) || parsed.mediaKey,
    subtitle: nullableStringValue(row.subtitle),
    posterUrl: nullableStringValue(row.poster_url),
    backdropUrl: nullableStringValue(row.backdrop_url),
    stillUrl: nullableStringValue(row.still_url),
    releaseYear: numberValue(row.release_year),
    rating: numberValue(row.metadata_rating),
    logoUrl: null,
    trailerUrl: null,
    trailerThumbnailUrl: null,
    posterColor: null,
    backdropColor: null,
    maturityRating: null,
    genres: [],
    language: 'en',
    overview: null,
    runtimeMinutes: null,
    releaseDate: null,
    status: null,
    episodeTitle: null,
    episodeAirDate: null,
  }, overrides);
}

function origins(row: WatchReadRow): string[] {
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
