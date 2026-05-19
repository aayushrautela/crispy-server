import { encodePublicItemId } from '../identity/public-item-id.js';
import { secondsToTicks, watchCacheRecordToBaseItemDto } from '../metadata/media-item.mapper.js';
import type { BaseItemDto, UserItemDataDto } from '../metadata/media-item.types.js';

export type WatchReadRow = Record<string, unknown>;

export function mapContinueWatchingRow(row: WatchReadRow): BaseItemDto {
  const titleItemId = encodePublicItemId(stringValue(row.title_item_id));
  const playableItemId = encodePublicItemId(stringValue(row.playable_item_id) || stringValue(row.title_item_id));
  const positionSeconds = numberValue(row.position_seconds);
  const durationSeconds = numberValue(row.duration_seconds);
  const lastActivityAt = isoValue(row.last_activity_at);
  const mediaItem = playableMediaItemDtoFromRow(playableItemId, titleItemId, row);

  return {
    ...mediaItem,
    UserData: {
      ItemId: playableItemId,
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
  const itemId = encodePublicItemId(stringValue(row.item_id));
  const addedAt = isoValue(row.added_at);
  return {
    ...mediaItemDtoFromRow(itemId, row),
    UserData: {
      ItemId: itemId,
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
  const itemId = encodePublicItemId(stringValue(row.item_id));
  const ratedAt = isoValue(row.rated_at);
  const ratingValue = numberValue(row.rating) ?? 0;
  return {
    ...mediaItemDtoFromRow(itemId, row),
    UserData: {
      ItemId: itemId,
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
  const itemId = encodePublicItemId(stringValue(row.item_id));
  const occurredAt = isoValue(row.occurred_at ?? row.watched_at);
  return {
    ...mediaItemDtoFromRow(itemId, row),
    UserData: {
      ItemId: itemId,
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
  const itemId = encodePublicItemId(stringValue(row.item_id));
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
    ItemId: itemId,
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
    ...mediaItemDtoFromRow(itemId, row, { UserData: userData }),
  };
}

function playableMediaItemDtoFromRow(playableItemId: string, titleItemId: string, row: WatchReadRow): BaseItemDto {
  const isEpisode = stringValue(row.media_type) === 'episode';
  const seriesName = isEpisode ? stringValue(row.title) || undefined : undefined;

  return watchCacheRecordToBaseItemDto({
    itemId: playableItemId,
    mediaType: stringValue(row.media_type) || (isEpisode ? 'episode' : 'movie'),
    titleProvider: 'tmdb',
    titleProviderId: stringValue(row.title_provider_id) || stringValue(row.tmdb_id) || '',
    titleMediaType: isEpisode ? 'show' : (row.media_type === 'movie' ? 'movie' : 'show'),
    title: stringValue(row.title) || playableItemId,
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
    Id: playableItemId,
    SeriesName: seriesName ?? null,
    SeasonId: isEpisode ? stringValue(row.season_id) || null : null,
    SeasonName: isEpisode ? nullableStringValue(row.season_name) : null,
    SeriesId: isEpisode ? titleItemId : null,
    ParentIndexNumber: isEpisode ? numberValue(row.season_number) : null,
    IndexNumber: isEpisode ? numberValue(row.episode_number) : null,
    AbsoluteIndexNumber: null,
    EpisodeTitle: isEpisode ? nullableStringValue(row.title) || null : null,
    AirDate: null,
  });
}

function mediaItemDtoFromRow(itemId: string, row: WatchReadRow, overrides: Partial<BaseItemDto> = {}): BaseItemDto {
  return watchCacheRecordToBaseItemDto({
    itemId: itemId,
    mediaType: stringValue(row.media_type) || 'movie',
    titleProvider: 'tmdb',
    titleProviderId: stringValue(row.title_provider_id) || stringValue(row.tmdb_id) || itemId,
    titleMediaType: stringValue(row.media_type) === 'movie' ? 'movie' : 'show',
    title: stringValue(row.title) || itemId,
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
    Id: itemId,
    ...overrides,
  });
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
