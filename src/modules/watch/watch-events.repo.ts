import type { DbClient } from '../../lib/db.js';
import { requireDbIsoString } from '../../lib/time.js';
import { normalizeWatchOccurredAt } from './watch.types.js';
import { deriveProgressPercent } from './heartbeat-policy.js';
import type { MediaIdentity } from '../identity/media-key.js';
import type { WatchMediaProjection } from './watch.types.js';
import type { WatchEventInput } from './watch.types.js';
import {
  WATCH_EVENT_PROJECTION_COLUMN_LIST,
  watchEventProjectionParams,
  watchEventProjectionPlaceholders,
  watchEventProjectionSelectList,
} from './watch-projection.persistence.js';

export type PersistedWatchEvent = {
  id: string;
  profileId: string;
  profileGroupId: string;
  eventType: string;
  mediaKey: string;
  occurredAt: string;
};

export type RebuildableWatchEvent = PersistedWatchEvent & {
  mediaType: string;
  provider: string | null;
  providerId: string | null;
  parentProvider: string | null;
  parentProviderId: string | null;
  tmdbId: number | null;
  showTmdbId: number | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  absoluteEpisodeNumber: number | null;
  detailsTitleId: string | null;
  detailsTitleMediaType: 'movie' | 'show' | 'anime' | null;
  highlightEpisodeId: string | null;
  playbackContentId: string | null;
  playbackMediaType: 'movie' | 'show' | 'episode' | 'anime' | null;
  playbackProvider: string | null;
  playbackProviderId: string | null;
  playbackParentProvider: string | null;
  playbackParentProviderId: string | null;
  playbackSeasonNumber: number | null;
  playbackEpisodeNumber: number | null;
  playbackAbsoluteEpisodeNumber: number | null;
  detailsSummary: string | null;
  detailsOverview: string | null;
  detailsStillUrl: string | null;
  detailsReleaseDate: string | null;
  detailsReleaseYear: number | null;
  detailsRuntimeMinutes: number | null;
  detailsRating: number | null;
  detailsStatus: string | null;
  detailsProvider: string | null;
  detailsProviderId: string | null;
  detailsParentProvider: string | null;
  detailsParentProviderId: string | null;
  title: string | null;
  subtitle: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  detailsTmdbId: number | null;
  detailsShowTmdbId: number | null;
  episodeTitle: string | null;
  episodeAirDate: string | null;
  episodeRuntimeMinutes: number | null;
  episodeStillUrl: string | null;
  episodeOverview: string | null;
  positionSeconds: number | null;
  durationSeconds: number | null;
  rating: number | null;
  payload: Record<string, unknown>;
};

export class WatchEventsRepository {
  async insert(client: DbClient, params: {
    profileGroupId: string;
    profileId: string;
    input: WatchEventInput;
    identity: MediaIdentity;
    projection?: WatchMediaProjection;
  }): Promise<PersistedWatchEvent> {
    const occurredAt = normalizeWatchOccurredAt(params.input.occurredAt);
    const result = await client.query(
      `
        INSERT INTO watch_events (
          profile_group_id,
          profile_id,
          client_event_id,
          event_type,
          media_key,
          media_type,
          provider,
          provider_id,
          parent_provider,
          parent_provider_id,
          tmdb_id,
          show_tmdb_id,
           season_number,
           episode_number,
           absolute_episode_number,
           ${WATCH_EVENT_PROJECTION_COLUMN_LIST},
           title,
           subtitle,
           poster_url,
          backdrop_url,
          position_seconds,
          duration_seconds,
          progress_percent,
          rating,
          occurred_at,
          payload
        )
        VALUES (
          $1::uuid,
          $2::uuid,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
           $12,
           $13,
           $14,
           $15,
            ${watchEventProjectionPlaceholders(16)},
            $47,
            $48,
            $49,
            $50,
            $51,
            $52,
            $53,
            $54,
            $55::timestamptz,
            $56::jsonb
          )
        ON CONFLICT (profile_id, client_event_id)
        DO UPDATE SET occurred_at = EXCLUDED.occurred_at
        RETURNING id, profile_id, profile_group_id, event_type, media_key, occurred_at
      `,
      [
        params.profileGroupId,
        params.profileId,
        params.input.clientEventId,
        params.input.eventType,
        params.identity.mediaKey,
        params.identity.mediaType,
        params.identity.provider,
        params.identity.providerId,
        params.identity.parentProvider,
        params.identity.parentProviderId,
        params.identity.tmdbId,
        params.identity.showTmdbId,
        params.identity.seasonNumber,
        params.identity.episodeNumber,
        params.identity.absoluteEpisodeNumber ?? null,
        ...watchEventProjectionParams(params.projection),
        params.projection?.title ?? null,
        params.projection?.subtitle ?? null,
        params.projection?.posterUrl ?? null,
        params.projection?.backdropUrl ?? null,
        params.input.positionSeconds ?? null,
        params.input.durationSeconds ?? null,
        deriveProgressPercent(params.input.positionSeconds, params.input.durationSeconds),
        params.input.rating ?? null,
        occurredAt,
        JSON.stringify(params.input.payload ?? {}),
      ],
      );

    return {
      id: String(result.rows[0].id),
      profileId: String(result.rows[0].profile_id),
      profileGroupId: String(result.rows[0].profile_group_id),
      eventType: String(result.rows[0].event_type),
      mediaKey: String(result.rows[0].media_key),
      occurredAt: requireDbIsoString(result.rows[0].occurred_at as Date | string | null | undefined, 'watch_events.occurred_at'),
    };
  }

  async listForProfile(client: DbClient, profileId: string): Promise<RebuildableWatchEvent[]> {
    const result = await client.query(
      `
        SELECT id, profile_id, profile_group_id, event_type, media_key, media_type,
               provider, provider_id, parent_provider, parent_provider_id,
               tmdb_id, show_tmdb_id, season_number, episode_number, absolute_episode_number,
                ${watchEventProjectionSelectList()},
               title, subtitle, poster_url, backdrop_url,
               position_seconds, duration_seconds, rating, occurred_at, payload
        FROM watch_events
        WHERE profile_id = $1::uuid
        ORDER BY occurred_at ASC, created_at ASC, id ASC
      `,
      [profileId],
    );

    return result.rows.map((row) => ({
      id: String(row.id),
      profileId: String(row.profile_id),
      profileGroupId: String(row.profile_group_id),
      eventType: String(row.event_type),
      mediaKey: String(row.media_key),
      mediaType: String(row.media_type),
      provider: typeof row.provider === 'string' ? row.provider : null,
      providerId: typeof row.provider_id === 'string' ? row.provider_id : null,
      parentProvider: typeof row.parent_provider === 'string' ? row.parent_provider : null,
      parentProviderId: typeof row.parent_provider_id === 'string' ? row.parent_provider_id : null,
      tmdbId: row.tmdb_id === null ? null : Number(row.tmdb_id),
      showTmdbId: row.show_tmdb_id === null ? null : Number(row.show_tmdb_id),
      seasonNumber: row.season_number === null ? null : Number(row.season_number),
      episodeNumber: row.episode_number === null ? null : Number(row.episode_number),
      absoluteEpisodeNumber: row.absolute_episode_number === null ? null : Number(row.absolute_episode_number),
      detailsTitleId: typeof row.details_title_id === 'string' ? row.details_title_id : null,
      detailsTitleMediaType: row.details_title_media_type === 'movie' || row.details_title_media_type === 'show' || row.details_title_media_type === 'anime'
        ? row.details_title_media_type
        : null,
      highlightEpisodeId: typeof row.highlight_episode_id === 'string' ? row.highlight_episode_id : null,
      playbackContentId: typeof row.playback_content_id === 'string' ? row.playback_content_id : null,
      playbackMediaType: row.playback_media_type === 'movie' || row.playback_media_type === 'show' || row.playback_media_type === 'episode' || row.playback_media_type === 'anime'
        ? row.playback_media_type
        : null,
      playbackProvider: typeof row.playback_provider === 'string' ? row.playback_provider : null,
      playbackProviderId: typeof row.playback_provider_id === 'string' ? row.playback_provider_id : null,
      playbackParentProvider: typeof row.playback_parent_provider === 'string' ? row.playback_parent_provider : null,
      playbackParentProviderId: typeof row.playback_parent_provider_id === 'string' ? row.playback_parent_provider_id : null,
      playbackSeasonNumber: row.playback_season_number === null ? null : Number(row.playback_season_number),
      playbackEpisodeNumber: row.playback_episode_number === null ? null : Number(row.playback_episode_number),
      playbackAbsoluteEpisodeNumber: row.playback_absolute_episode_number === null ? null : Number(row.playback_absolute_episode_number),
      detailsSummary: typeof row.details_summary === 'string' ? row.details_summary : null,
      detailsOverview: typeof row.details_overview === 'string' ? row.details_overview : null,
      detailsStillUrl: typeof row.details_still_url === 'string' ? row.details_still_url : null,
      detailsReleaseDate: typeof row.details_release_date === 'string' ? row.details_release_date : null,
      detailsReleaseYear: row.details_release_year === null ? null : Number(row.details_release_year),
      detailsRuntimeMinutes: row.details_runtime_minutes === null ? null : Number(row.details_runtime_minutes),
      detailsRating: row.details_rating === null ? null : Number(row.details_rating),
      detailsStatus: typeof row.details_status === 'string' ? row.details_status : null,
      detailsProvider: typeof row.details_provider === 'string' ? row.details_provider : null,
      detailsProviderId: typeof row.details_provider_id === 'string' ? row.details_provider_id : null,
      detailsParentProvider: typeof row.details_parent_provider === 'string' ? row.details_parent_provider : null,
      detailsParentProviderId: typeof row.details_parent_provider_id === 'string' ? row.details_parent_provider_id : null,
      title: typeof row.title === 'string' ? row.title : null,
      subtitle: typeof row.subtitle === 'string' ? row.subtitle : null,
      posterUrl: typeof row.poster_url === 'string' ? row.poster_url : null,
      backdropUrl: typeof row.backdrop_url === 'string' ? row.backdrop_url : null,
      detailsTmdbId: row.details_tmdb_id === null ? null : Number(row.details_tmdb_id),
      detailsShowTmdbId: row.details_show_tmdb_id === null ? null : Number(row.details_show_tmdb_id),
      episodeTitle: typeof row.episode_title === 'string' ? row.episode_title : null,
      episodeAirDate: typeof row.episode_air_date === 'string' ? row.episode_air_date : null,
      episodeRuntimeMinutes: row.episode_runtime_minutes === null ? null : Number(row.episode_runtime_minutes),
      episodeStillUrl: typeof row.episode_still_url === 'string' ? row.episode_still_url : null,
      episodeOverview: typeof row.episode_overview === 'string' ? row.episode_overview : null,
      positionSeconds: row.position_seconds === null ? null : Number(row.position_seconds),
      durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
      rating: row.rating === null ? null : Number(row.rating),
      occurredAt: requireDbIsoString(row.occurred_at as Date | string | null | undefined, 'watch_events.occurred_at'),
      payload: (row.payload as Record<string, unknown> | undefined) ?? {},
    }));
  }
}
