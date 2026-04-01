import type { WatchMediaProjection } from './watch.types.js';

export const WATCH_PROJECTION_COLUMN_NAMES = [
  'details_title_media_type',
  'playback_media_type',
  'playback_provider',
  'playback_provider_id',
  'playback_parent_provider',
  'playback_parent_provider_id',
  'playback_season_number',
  'playback_episode_number',
  'playback_absolute_episode_number',
  'details_still_url',
  'details_release_year',
  'details_runtime_minutes',
  'details_rating',
  'episode_title',
  'episode_air_date',
  'episode_runtime_minutes',
  'episode_still_url',
] as const;

// Raw watch events intentionally store a smaller projection contract than the
// derived read models. Keep this list in sync with the watch_events schema.
export const WATCH_EVENT_PROJECTION_COLUMN_NAMES = [
  'details_title_media_type',
  'playback_media_type',
  'playback_provider',
  'playback_provider_id',
  'playback_parent_provider',
  'playback_parent_provider_id',
  'playback_season_number',
  'playback_episode_number',
  'playback_absolute_episode_number',
  'details_still_url',
  'details_release_year',
  'details_runtime_minutes',
  'details_rating',
  'episode_title',
  'episode_air_date',
  'episode_runtime_minutes',
  'episode_still_url',
] as const;

export const WATCH_PROJECTION_COLUMN_LIST = WATCH_PROJECTION_COLUMN_NAMES.join(', ');
export const WATCH_EVENT_PROJECTION_COLUMN_LIST = WATCH_EVENT_PROJECTION_COLUMN_NAMES.join(', ');

export function watchProjectionPlaceholders(startIndex: number): string {
  return WATCH_PROJECTION_COLUMN_NAMES.map((_, index) => `$${startIndex + index}`).join(', ');
}

export function watchEventProjectionPlaceholders(startIndex: number): string {
  return WATCH_EVENT_PROJECTION_COLUMN_NAMES.map((_, index) => `$${startIndex + index}`).join(', ');
}

export function watchProjectionUpdateAssignments(): string {
  return WATCH_PROJECTION_COLUMN_NAMES.map((column) => `${column} = EXCLUDED.${column}`).join(',\n          ');
}

export function watchProjectionSelectList(tableAlias?: string): string {
  const prefix = tableAlias ? `${tableAlias}.` : '';
  return WATCH_PROJECTION_COLUMN_NAMES.map((column) => `${prefix}${column}`).join(', ');
}

export function watchEventProjectionSelectList(tableAlias?: string): string {
  const prefix = tableAlias ? `${tableAlias}.` : '';
  return WATCH_EVENT_PROJECTION_COLUMN_NAMES.map((column) => `${prefix}${column}`).join(', ');
}

export function watchProjectionParams(projection?: WatchMediaProjection): unknown[] {
  return [
    projection?.detailsTitleMediaType ?? null,
    projection?.playbackMediaType ?? null,
    projection?.playbackProvider ?? null,
    projection?.playbackProviderId ?? null,
    projection?.playbackParentProvider ?? null,
    projection?.playbackParentProviderId ?? null,
    projection?.playbackSeasonNumber ?? null,
    projection?.playbackEpisodeNumber ?? null,
    projection?.playbackAbsoluteEpisodeNumber ?? null,
    projection?.detailsStillUrl ?? null,
    projection?.detailsReleaseYear ?? null,
    projection?.detailsRuntimeMinutes ?? null,
    projection?.detailsRating ?? null,
    projection?.episodeTitle ?? null,
    projection?.episodeAirDate ?? null,
    projection?.episodeRuntimeMinutes ?? null,
    projection?.episodeStillUrl ?? null,
  ];
}

export function watchEventProjectionParams(projection?: WatchMediaProjection): unknown[] {
  return [
    projection?.detailsTitleMediaType ?? null,
    projection?.playbackMediaType ?? null,
    projection?.playbackProvider ?? null,
    projection?.playbackProviderId ?? null,
    projection?.playbackParentProvider ?? null,
    projection?.playbackParentProviderId ?? null,
    projection?.playbackSeasonNumber ?? null,
    projection?.playbackEpisodeNumber ?? null,
    projection?.playbackAbsoluteEpisodeNumber ?? null,
    projection?.detailsStillUrl ?? null,
    projection?.detailsReleaseYear ?? null,
    projection?.detailsRuntimeMinutes ?? null,
    projection?.detailsRating ?? null,
    projection?.episodeTitle ?? null,
    projection?.episodeAirDate ?? null,
    projection?.episodeRuntimeMinutes ?? null,
    projection?.episodeStillUrl ?? null,
  ];
}
