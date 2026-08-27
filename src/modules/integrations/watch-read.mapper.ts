import { encodePublicItemId } from '../identity/public-item-id.js';
import { secondsToTicks, watchCacheRecordToBaseItemDto } from '../metadata/media-item.mapper.js';
import type { BaseItemDto, ProviderIdsDto, UserItemDataDto } from '../metadata/media-item.types.js';
import type { WatchInternalRef } from '../watch/watch-read.types.js';

export type WatchReadRow = Record<string, unknown>;

// --- Phase 1 seam: InternalRef mappers (Brain 1). No title/poster/overview. ---

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

export function mapContinueWatchingRow(row: WatchReadRow): BaseItemDto | null {
  const rawPlayableItemId = stringValue(row.playable_item_id) || stringValue(row.title_item_id);
  const rawTitleItemId = stringValue(row.title_item_id) || rawPlayableItemId;
  const titleItemId = encodePublicItemId(rawTitleItemId);
  const playableItemId = encodePublicItemId(rawPlayableItemId);
  const positionSeconds = numberValue(row.position_seconds);
  const durationSeconds = numberValue(row.duration_seconds);
  const progressBps = numberValue(row.progress_bps);
  const lastActivityAt = isoValue(row.last_activity_at);
  const seasonNumber = numberValue(row.season_number);
  const episodeNumber = numberValue(row.episode_number);
  const isEpisode = stringValue(row.media_type) === 'episode'
    || (seasonNumber !== null && episodeNumber !== null);

  // Continue Watching entries are strictly Movie or Episode. TV is always stored as
  // 'episode' with season/episode, so a 'show' row without them is legacy/garbage data
  // and must not surface as a series-level card.
  if (stringValue(row.media_type) !== 'movie' && !isEpisode) {
    return null;
  }

  const mediaItem = playableMediaItemDtoFromRow(playableItemId, titleItemId, row, isEpisode);

  return {
    ...mediaItem,
    UserData: {
      ItemId: playableItemId,
      IsFavorite: false,
      Played: false,
      PlayCount: 0,
      PlaybackPositionTicks: secondsToTicks(positionSeconds),
      RuntimeTicks: secondsToTicks(durationSeconds),
      PlayedPercentage: progressBps !== null ? progressBps / 100 : null,
      LastPlayedDate: lastActivityAt,
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
  const mediaType = stringValue(row.media_type);
  const isEpisode = mediaType === 'episode';
  const overrides: Partial<BaseItemDto> = {};
  if (isEpisode) {
    const seasonNumber = numberValue(row.season_number);
    const episodeNumber = numberValue(row.episode_number);
    if (seasonNumber !== null) overrides.ParentIndexNumber = seasonNumber;
    if (episodeNumber !== null) overrides.IndexNumber = episodeNumber;
    const titleItemId = stringValue(row.title_item_id);
    if (titleItemId) overrides.SeriesId = encodePublicItemId(titleItemId);
  }
  return {
    ...mediaItemDtoFromRow(itemId, row, overrides),
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
  const positionSeconds = numberValue(row.position_seconds);
  const durationSeconds = numberValue(row.duration_seconds);
  const lastPlayedAt = nullableIsoValue(row.last_played_at);
  const rating = numberValue(row.rating);
  const played = row.played === true;
  const playCount = numberValue(row.play_count) ?? 0;
  const isFavorite = row.is_favorite === true;

  const userData: UserItemDataDto = {
    ItemId: itemId,
    IsFavorite: isFavorite,
    Played: played,
    PlayCount: playCount,
    PlaybackPositionTicks: secondsToTicks(positionSeconds),
    RuntimeTicks: secondsToTicks(durationSeconds),
    PlayedPercentage: progressBps !== null ? progressBps / 100 : null,
    LastPlayedDate: lastPlayedAt,
    Rating: rating !== null ? rating : null,
    DismissedFromContinueWatching: false,
  };

  const mediaType = stringValue(row.media_type);
  const isEpisode = mediaType === 'episode';
  const overrides: Partial<BaseItemDto> = { UserData: userData };
  if (isEpisode) {
    const seasonNumber = numberValue(row.season_number);
    const episodeNumber = numberValue(row.episode_number);
    if (seasonNumber !== null) overrides.ParentIndexNumber = seasonNumber;
    if (episodeNumber !== null) overrides.IndexNumber = episodeNumber;
    const showTmdbId = nullableStringValue(row.show_tmdb_id);
    if (showTmdbId != null) {
      overrides.ProviderIds = {
        Tmdb: showTmdbId,
        Imdb: nullableStringValue(row.imdb_id),
        Tvdb: nullableStringValue(row.tvdb_id),
      };
    }
  }

  return {
    ...mediaItemDtoFromRow(itemId, row, overrides),
  };
}

function playableMediaItemDtoFromRow(playableItemId: string, titleItemId: string, row: WatchReadRow, isEpisode: boolean): BaseItemDto {
  const seriesName = isEpisode ? stringValue(row.title) || undefined : undefined;

  return watchCacheRecordToBaseItemDto({
    itemId: playableItemId,
    mediaType: isEpisode ? 'episode' : (stringValue(row.media_type) || 'movie'),
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
    ProviderIds: providerIdsFromRow(row),
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
    titleProviderId: stringValue(row.title_provider_id) || stringValue(row.tmdb_id) || '',
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
    ProviderIds: providerIdsFromRow(row),
    ...overrides,
  });
}

function providerIdsFromRow(row: WatchReadRow): ProviderIdsDto {
  return {
    Tmdb: nullableStringValue(row.title_provider_id) ?? nullableStringValue(row.tmdb_id),
    Imdb: nullableStringValue(row.imdb_id),
    Tvdb: nullableStringValue(row.tvdb_id),
  };
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
