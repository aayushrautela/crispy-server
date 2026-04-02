import type { DbClient } from '../../lib/db.js';
import { requireDbIsoString, toDbIsoString } from '../../lib/time.js';
import { ProfileAccessService } from '../profiles/profile-access.service.js';
import { parseMediaKey } from '../identity/media-key.js';
import type { RegularCardView } from '../metadata/metadata.types.js';
import { ProviderMetadataService } from '../metadata/provider-metadata.service.js';
import { decodeWatchPageCursor, encodeWatchPageCursor } from './watch-pagination.js';
import type { PaginatedWatchCollection } from './watch-read.types.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { encodeWatchV2ContinueWatchingId, resolveWatchV2Lookup } from './watch-v2-utils.js';
import { listWatchV2WatchedEpisodeKeys } from './watch-v2-episode-keys.js';
import { WatchV2EpisodeHistoryService } from '../watch-v2/watch-v2-episode-history.service.js';
import { WatchV2TrackedQueryService } from './watch-v2-tracked-query.service.js';

type RawWatchProjectionSnapshot = {
  detailsTitleMediaType: 'movie' | 'show' | 'anime' | null;
  playbackMediaType: 'movie' | 'show' | 'episode' | 'anime' | null;
  playbackProvider: string | null;
  playbackProviderId: string | null;
  playbackParentProvider: string | null;
  playbackParentProviderId: string | null;
  playbackSeasonNumber: number | null;
  playbackEpisodeNumber: number | null;
  playbackAbsoluteEpisodeNumber: number | null;
  detailsStillUrl: string | null;
  detailsReleaseYear: number | null;
  detailsRuntimeMinutes: number | null;
  detailsRating: number | null;
  episodeTitle: string | null;
  episodeAirDate: string | null;
  episodeRuntimeMinutes: number | null;
  episodeStillUrl: string | null;
};

export type RawContinueWatchingRow = RawWatchProjectionSnapshot & {
  id: string;
  mediaKey: string;
  mediaType: string;
  tmdbId: number | null;
  showTmdbId: number | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  title: string | null;
  subtitle: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  positionSeconds: number | null;
  durationSeconds: number | null;
  progressPercent: number;
  lastActivityAt: string;
  payload: Record<string, unknown>;
};

export type RawWatchHistoryRow = RawWatchProjectionSnapshot & {
  mediaKey: string;
  mediaType: string;
  tmdbId: number | null;
  showTmdbId: number | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  title: string | null;
  subtitle: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  watchedAt: string;
  payload: Record<string, unknown>;
  media: RegularCardView | null;
};

export type RawWatchlistRow = RawWatchProjectionSnapshot & {
  mediaKey: string;
  mediaType: string;
  tmdbId: number | null;
  title: string | null;
  subtitle: string | null;
  posterUrl: string | null;
  releaseYear: number | null;
  titleRating: number | null;
  addedAt: string;
  payload: Record<string, unknown>;
  media: RegularCardView | null;
};

export type RawRatingRow = RawWatchProjectionSnapshot & {
  mediaKey: string;
  mediaType: string;
  tmdbId: number | null;
  title: string | null;
  subtitle: string | null;
  posterUrl: string | null;
  releaseYear: number | null;
  titleRating: number | null;
  rating: number;
  ratedAt: string;
  payload: Record<string, unknown>;
  media: RegularCardView | null;
};

export type RawProgressRow = {
  positionSeconds: number;
  durationSeconds: number | null;
  progressPercent: number;
  status: string;
  lastPlayedAt: string;
};

export type RawTrackedSeriesRow = {
  trackedMediaKey: string;
  trackedMediaType: 'show' | 'anime';
  provider: string;
  providerId: string;
  reason: string | null;
  lastInteractedAt: string;
  nextEpisodeAirDate: string | null;
  metadataRefreshedAt: string | null;
  payload: Record<string, unknown>;
};

type WatchPageParams = {
  limit: number;
  cursor?: string | null;
};

function mapProjectionSnapshot(row: Record<string, unknown>): RawWatchProjectionSnapshot {
  return {
    detailsTitleMediaType: row.details_title_media_type === 'movie' || row.details_title_media_type === 'show' || row.details_title_media_type === 'anime'
      ? row.details_title_media_type
      : null,
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
    detailsStillUrl: typeof row.details_still_url === 'string' ? row.details_still_url : null,
    detailsReleaseYear: row.details_release_year === null ? null : Number(row.details_release_year),
    detailsRuntimeMinutes: row.details_runtime_minutes === null ? null : Number(row.details_runtime_minutes),
    detailsRating: row.details_rating === null ? null : Number(row.details_rating),
    episodeTitle: typeof row.episode_title === 'string' ? row.episode_title : null,
    episodeAirDate: typeof row.episode_air_date === 'string' ? row.episode_air_date : null,
    episodeRuntimeMinutes: row.episode_runtime_minutes === null ? null : Number(row.episode_runtime_minutes),
    episodeStillUrl: typeof row.episode_still_url === 'string' ? row.episode_still_url : null,
  };
}

function mapContinueWatchingRow(row: Record<string, unknown>): RawContinueWatchingRow {
  return {
    ...mapProjectionSnapshot(row),
    id: String(row.id),
    mediaKey: String(row.media_key),
    mediaType: String(row.media_type),
    tmdbId: row.tmdb_id === null ? null : Number(row.tmdb_id),
    showTmdbId: row.show_tmdb_id === null ? null : Number(row.show_tmdb_id),
    seasonNumber: row.season_number === null ? null : Number(row.season_number),
    episodeNumber: row.episode_number === null ? null : Number(row.episode_number),
    title: typeof row.title === 'string' ? row.title : null,
    subtitle: typeof row.subtitle === 'string' ? row.subtitle : null,
    posterUrl: typeof row.poster_url === 'string' ? row.poster_url : null,
    backdropUrl: typeof row.backdrop_url === 'string' ? row.backdrop_url : null,
    positionSeconds: row.position_seconds === null ? null : Number(row.position_seconds),
    durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
    progressPercent: Number(row.progress_percent ?? 0),
    lastActivityAt: requireDbIsoString(row.last_activity_at as Date | string | null | undefined, 'watch_continue.last_activity_at'),
    payload: (row.payload as Record<string, unknown> | undefined) ?? {},
  };
}

function mapWatchHistoryRow(row: Record<string, unknown>): RawWatchHistoryRow {
  return {
    ...emptyProjectionSnapshot(),
    mediaKey: String(row.media_key),
    mediaType: String(row.media_type),
    tmdbId: row.tmdb_id === null ? null : Number(row.tmdb_id),
    showTmdbId: row.show_tmdb_id === null ? null : Number(row.show_tmdb_id),
    seasonNumber: row.season_number === null ? null : Number(row.season_number),
    episodeNumber: row.episode_number === null ? null : Number(row.episode_number),
    title: null,
    subtitle: null,
    posterUrl: null,
    backdropUrl: null,
    watchedAt: requireDbIsoString(row.watched_at as Date | string | null | undefined, 'watch_history.watched_at'),
    payload: (row.payload as Record<string, unknown> | undefined) ?? {},
    media: null,
  };
}

function mapWatchlistRow(row: Record<string, unknown>): RawWatchlistRow {
  return {
    ...mapProjectionSnapshot(row),
    mediaKey: String(row.title_media_key ?? row.media_key),
    mediaType: String(row.title_media_type ?? row.media_type),
    tmdbId: null,
    title: typeof row.title_text === 'string' ? row.title_text : null,
    subtitle: typeof row.title_subtitle === 'string' ? row.title_subtitle : null,
    posterUrl: typeof row.title_poster_url === 'string' ? row.title_poster_url : null,
    releaseYear: row.title_release_year === null ? null : Number(row.title_release_year),
    titleRating: row.title_rating === null ? null : Number(row.title_rating),
    addedAt: requireDbIsoString(
      row.watchlist_updated_at as Date | string | null | undefined ?? row.added_at as Date | string | null | undefined,
      'profile_title_projection.watchlist_updated_at',
    ),
    payload: {},
    media: null,
  };
}

function mapRatingRow(row: Record<string, unknown>): RawRatingRow {
  return {
    ...mapProjectionSnapshot(row),
    mediaKey: String(row.title_media_key ?? row.media_key),
    mediaType: String(row.title_media_type ?? row.media_type),
    tmdbId: null,
    title: typeof row.title_text === 'string' ? row.title_text : null,
    subtitle: typeof row.title_subtitle === 'string' ? row.title_subtitle : null,
    posterUrl: typeof row.title_poster_url === 'string' ? row.title_poster_url : null,
    releaseYear: row.title_release_year === null ? null : Number(row.title_release_year),
    titleRating: row.title_rating === null ? null : Number(row.title_rating),
    rating: Number(row.rating_value ?? row.rating),
    ratedAt: requireDbIsoString(
      row.rated_at as Date | string | null | undefined,
      'profile_title_projection.rated_at',
    ),
    payload: {},
    media: null,
  };
}

function emptyProjectionSnapshot(): RawWatchProjectionSnapshot {
  return {
    detailsTitleMediaType: null,
    playbackMediaType: null,
    playbackProvider: null,
    playbackProviderId: null,
    playbackParentProvider: null,
    playbackParentProviderId: null,
    playbackSeasonNumber: null,
    playbackEpisodeNumber: null,
    playbackAbsoluteEpisodeNumber: null,
    detailsStillUrl: null,
    detailsReleaseYear: null,
    detailsRuntimeMinutes: null,
    detailsRating: null,
    episodeTitle: null,
    episodeAirDate: null,
    episodeRuntimeMinutes: null,
    episodeStillUrl: null,
  };
}

export class WatchQueryService {
  constructor(
    private readonly profileAccessService = new ProfileAccessService(),
    private readonly contentIdentityService = new ContentIdentityService(),
    private readonly providerMetadataService = new ProviderMetadataService(),
    private readonly episodeHistoryService = new WatchV2EpisodeHistoryService(),
    private readonly trackedQueryService = new WatchV2TrackedQueryService(),
  ) {}

  async listContinueWatching(client: DbClient, profileId: string, limit: number): Promise<RawContinueWatchingRow[]> {
    const page = await this.listContinueWatchingPage(client, profileId, { limit });
    return page.items;
  }

  async listContinueWatchingPage(client: DbClient, profileId: string, params: WatchPageParams): Promise<PaginatedWatchCollection<RawContinueWatchingRow>> {
    const cursor = decodeWatchPageCursor(params.cursor);
    const result = await client.query(
      `
        SELECT *
        FROM profile_title_projection
        WHERE profile_id = $1::uuid
          AND has_in_progress = true
          AND dismissed_at IS NULL
          AND last_activity_at IS NOT NULL
          AND (
            $2::timestamptz IS NULL
            OR last_activity_at < $2::timestamptz
            OR (last_activity_at = $2::timestamptz AND title_content_id::text < $3)
          )
        ORDER BY last_activity_at DESC, title_content_id DESC
        LIMIT $4
      `,
      [profileId, cursor?.sortValue ?? null, cursor?.tieBreaker ?? null, params.limit + 1],
    );
    const rows = result.rows.slice(0, params.limit);
    const items = rows.map((row) => mapContinueWatchingProjectionRow(row));
    const last = items.at(-1) ?? null;
    return {
      items,
      pageInfo: {
        nextCursor: result.rows.length > params.limit && last ? encodeWatchPageCursor({ sortValue: last.lastActivityAt, tieBreaker: last.id }) : null,
        hasMore: result.rows.length > params.limit,
      },
    };
  }

  async listWatchHistory(client: DbClient, profileId: string, limit: number): Promise<RawWatchHistoryRow[]> {
    const page = await this.listWatchHistoryPage(client, profileId, { limit });
    return page.items;
  }

  async listWatchHistoryPage(client: DbClient, profileId: string, params: WatchPageParams): Promise<PaginatedWatchCollection<RawWatchHistoryRow>> {
    const cursor = decodeWatchPageCursor(params.cursor);
    const result = await client.query(
      `
        SELECT *
        FROM profile_title_projection
        WHERE profile_id = $1::uuid
          AND effective_watched = true
          AND last_watched_at IS NOT NULL
          AND (
            $2::timestamptz IS NULL
            OR last_watched_at < $2::timestamptz
            OR (last_watched_at = $2::timestamptz AND title_content_id::text < $3)
          )
        ORDER BY last_watched_at DESC, title_content_id DESC
        LIMIT $4
      `,
      [profileId, cursor?.sortValue ?? null, cursor?.tieBreaker ?? null, params.limit + 1],
    );
    const rows = result.rows.slice(0, params.limit);
    const items = rows.map((row) => mapWatchHistoryProjectionRow(row));
    const last = items.at(-1) ?? null;
    return {
      items,
      pageInfo: {
        nextCursor: result.rows.length > params.limit && last ? encodeWatchPageCursor({ sortValue: last.watchedAt, tieBreaker: last.mediaKey }) : null,
        hasMore: result.rows.length > params.limit,
      },
    };
  }

  async listWatchlist(client: DbClient, profileId: string, limit: number): Promise<RawWatchlistRow[]> {
    const page = await this.listWatchlistPage(client, profileId, { limit });
    return page.items;
  }

  async listWatchlistPage(client: DbClient, profileId: string, params: WatchPageParams): Promise<PaginatedWatchCollection<RawWatchlistRow>> {
    const cursor = decodeWatchPageCursor(params.cursor);
    const result = await client.query(
      `
        SELECT *
        FROM profile_title_projection
        WHERE profile_id = $1::uuid
          AND watchlist_present = true
          AND watchlist_updated_at IS NOT NULL
          AND (
            $2::timestamptz IS NULL
            OR watchlist_updated_at < $2::timestamptz
            OR (watchlist_updated_at = $2::timestamptz AND title_content_id::text < $3)
          )
        ORDER BY watchlist_updated_at DESC, title_content_id DESC
        LIMIT $4
      `,
      [profileId, cursor?.sortValue ?? null, cursor?.tieBreaker ?? null, params.limit + 1],
    );
    const rows = result.rows.slice(0, params.limit);
    const items = rows.map(mapWatchlistRow);
    const last = items.at(-1) ?? null;
    return {
      items,
      pageInfo: {
        nextCursor: result.rows.length > params.limit && last ? encodeWatchPageCursor({ sortValue: last.addedAt, tieBreaker: last.mediaKey }) : null,
        hasMore: result.rows.length > params.limit,
      },
    };
  }

  async listRatings(client: DbClient, profileId: string, limit: number): Promise<RawRatingRow[]> {
    const page = await this.listRatingsPage(client, profileId, { limit });
    return page.items;
  }

  async listTrackedSeries(client: DbClient, profileId: string, limit: number): Promise<RawTrackedSeriesRow[]> {
    const rows = await this.trackedQueryService.listTrackedTitles(client, profileId, limit);
    return rows.map((row) => ({
      trackedMediaKey: row.trackedMediaKey,
      trackedMediaType: row.trackedMediaType,
      provider: row.provider,
      providerId: row.providerId,
      reason: row.reason,
      lastInteractedAt: row.lastInteractedAt,
      nextEpisodeAirDate: row.nextEpisodeAirDate,
      metadataRefreshedAt: row.metadataRefreshedAt,
      payload: row.payload,
    }));
  }

  async listRatingsPage(client: DbClient, profileId: string, params: WatchPageParams): Promise<PaginatedWatchCollection<RawRatingRow>> {
    const cursor = decodeWatchPageCursor(params.cursor);
    const result = await client.query(
      `
        SELECT *
        FROM profile_title_projection
        WHERE profile_id = $1::uuid
          AND rating_value IS NOT NULL
          AND rated_at IS NOT NULL
          AND (
            $2::timestamptz IS NULL
            OR rated_at < $2::timestamptz
            OR (rated_at = $2::timestamptz AND title_content_id::text < $3)
          )
        ORDER BY rated_at DESC, title_content_id DESC
        LIMIT $4
      `,
      [profileId, cursor?.sortValue ?? null, cursor?.tieBreaker ?? null, params.limit + 1],
    );
    const rows = result.rows.slice(0, params.limit);
    const items = rows.map(mapRatingRow);
    const last = items.at(-1) ?? null;
    return {
      items,
      pageInfo: {
        nextCursor: result.rows.length > params.limit && last ? encodeWatchPageCursor({ sortValue: last.ratedAt, tieBreaker: last.mediaKey }) : null,
        hasMore: result.rows.length > params.limit,
      },
    };
  }

  async getProgress(client: DbClient, profileId: string, mediaKey: string): Promise<RawProgressRow | null> {
    const lookup = await resolveWatchV2Lookup(client, this.contentIdentityService, parseMediaKey(mediaKey));
    const identity = parseMediaKey(mediaKey);
    if (identity.mediaType !== 'movie' && identity.mediaType !== 'episode') {
      return null;
    }
    const result = await client.query(
      `
        SELECT position_seconds, duration_seconds, progress_percent, playback_status, last_activity_at
        FROM profile_playable_state
        WHERE profile_id = $1::uuid AND content_id = $2::uuid
      `,
      [profileId, lookup.contentId],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return {
      positionSeconds: Number(row.position_seconds ?? 0),
      durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
      progressPercent: Number(row.progress_percent ?? 0),
      status: String(row.playback_status),
      lastPlayedAt: requireDbIsoString(row.last_activity_at as Date | string | null | undefined, 'profile_playable_state.last_activity_at'),
    };
  }

  async getContinueWatchingByMediaKey(client: DbClient, profileId: string, mediaKey: string): Promise<RawContinueWatchingRow | null> {
    const lookup = await resolveWatchV2Lookup(client, this.contentIdentityService, parseMediaKey(mediaKey));
    const result = await client.query(
      `
        SELECT *
        FROM profile_title_projection
        WHERE profile_id = $1::uuid
          AND title_content_id = $2::uuid
          AND has_in_progress = true
          AND dismissed_at IS NULL
      `,
      [profileId, lookup.titleContentId],
    );
    const row = result.rows[0];
    return row ? mapContinueWatchingProjectionRow(row) : null;
  }

  async getWatchHistoryByMediaKey(client: DbClient, profileId: string, mediaKey: string): Promise<RawWatchHistoryRow | null> {
    const identity = parseMediaKey(mediaKey);
    if (identity.mediaType === 'episode') {
      const lookup = await resolveWatchV2Lookup(client, this.contentIdentityService, identity);
      const watchedAt = await this.episodeHistoryService.getEpisodeWatchedAt(client, profileId, lookup.contentId, lookup.titleContentId, null);
      return watchedAt
        ? {
            ...emptyProjectionSnapshot(),
            mediaKey,
            mediaType: identity.mediaType,
            tmdbId: identity.tmdbId ?? null,
            showTmdbId: identity.showTmdbId ?? null,
            seasonNumber: identity.seasonNumber ?? null,
            episodeNumber: identity.episodeNumber ?? null,
            title: null,
            subtitle: null,
            posterUrl: null,
            backdropUrl: null,
            watchedAt,
            payload: {},
            media: null,
          }
        : null;
    }
    const lookup = await resolveWatchV2Lookup(client, this.contentIdentityService, identity);
    const result = await client.query(
      `
        SELECT *
        FROM profile_title_projection
        WHERE profile_id = $1::uuid
          AND title_content_id = $2::uuid
          AND effective_watched = true
          AND last_watched_at IS NOT NULL
      `,
      [profileId, lookup.titleContentId],
    );
    const row = result.rows[0];
    return row ? mapWatchHistoryProjectionRow(row) : null;
  }

  async getWatchlistByMediaKey(client: DbClient, profileId: string, mediaKey: string): Promise<RawWatchlistRow | null> {
    const lookup = await resolveWatchV2Lookup(client, this.contentIdentityService, parseMediaKey(mediaKey));
    const result = await client.query(
      `
        SELECT *
        FROM profile_title_projection
        WHERE profile_id = $1::uuid
          AND title_content_id = $2::uuid
          AND watchlist_present = true
          AND watchlist_updated_at IS NOT NULL
      `,
      [profileId, lookup.titleContentId],
    );
    const row = result.rows[0];
    return row ? mapWatchlistRow(row) : null;
  }

  async getRatingByMediaKey(client: DbClient, profileId: string, mediaKey: string): Promise<RawRatingRow | null> {
    const lookup = await resolveWatchV2Lookup(client, this.contentIdentityService, parseMediaKey(mediaKey));
    const result = await client.query(
      `
        SELECT *
        FROM profile_title_projection
        WHERE profile_id = $1::uuid
          AND title_content_id = $2::uuid
          AND rating_value IS NOT NULL
          AND rated_at IS NOT NULL
      `,
      [profileId, lookup.titleContentId],
    );
    const row = result.rows[0];
    return row ? mapRatingRow(row) : null;
  }

  async listWatchedEpisodeKeysForShow(client: DbClient, profileId: string, trackedMediaKey: string): Promise<string[]> {
    const trackedIdentity = parseMediaKey(trackedMediaKey);
    if (trackedIdentity.mediaType !== 'show' && trackedIdentity.mediaType !== 'anime') {
      return [];
    }
    const lookup = await resolveWatchV2Lookup(client, this.contentIdentityService, trackedIdentity);
    return listWatchV2WatchedEpisodeKeys(
      client,
      this.contentIdentityService,
      this.providerMetadataService,
      profileId,
      trackedIdentity,
      lookup.titleContentId,
    );
  }
}

function mapContinueWatchingProjectionRow(row: Record<string, unknown>): RawContinueWatchingRow {
  return {
    ...mapProjectionSnapshotFromTitleRow(row),
    id: encodeWatchV2ContinueWatchingId(String(row.title_content_id)),
    mediaKey: typeof row.active_media_key === 'string' ? row.active_media_key : String(row.title_media_key),
    mediaType: typeof row.active_media_type === 'string' ? row.active_media_type : String(row.title_media_type),
    tmdbId: null,
    showTmdbId: null,
    seasonNumber: row.active_season_number === null ? null : Number(row.active_season_number),
    episodeNumber: row.active_episode_number === null ? null : Number(row.active_episode_number),
    title: typeof row.title_text === 'string' ? row.title_text : null,
    subtitle: typeof row.title_subtitle === 'string' ? row.title_subtitle : null,
    posterUrl: typeof row.title_poster_url === 'string' ? row.title_poster_url : null,
    backdropUrl: typeof row.title_backdrop_url === 'string' ? row.title_backdrop_url : null,
    positionSeconds: row.active_position_seconds === null ? null : Number(row.active_position_seconds),
    durationSeconds: row.active_duration_seconds === null ? null : Number(row.active_duration_seconds),
    progressPercent: Number(row.active_progress_percent ?? 0),
    lastActivityAt: requireDbIsoString(row.last_activity_at as Date | string | null | undefined, 'profile_title_projection.last_activity_at'),
    payload: {},
  };
}

function mapWatchHistoryProjectionRow(row: Record<string, unknown>): RawWatchHistoryRow {
  return {
    ...mapProjectionSnapshotFromTitleRow(row),
    mediaKey: String(row.title_media_key),
    mediaType: String(row.title_media_type),
    tmdbId: null,
    showTmdbId: null,
    seasonNumber: null,
    episodeNumber: null,
    title: typeof row.title_text === 'string' ? row.title_text : null,
    subtitle: typeof row.title_subtitle === 'string' ? row.title_subtitle : null,
    posterUrl: typeof row.title_poster_url === 'string' ? row.title_poster_url : null,
    backdropUrl: typeof row.title_backdrop_url === 'string' ? row.title_backdrop_url : null,
    watchedAt: requireDbIsoString(row.last_watched_at as Date | string | null | undefined, 'profile_title_projection.last_watched_at'),
    payload: {},
    media: null,
  };
}

function mapProjectionSnapshotFromTitleRow(row: Record<string, unknown>): RawWatchProjectionSnapshot {
  return {
    detailsTitleMediaType: row.title_media_type === 'movie' || row.title_media_type === 'show' || row.title_media_type === 'anime'
      ? row.title_media_type
      : null,
    playbackMediaType: row.active_media_type === 'movie' || row.active_media_type === 'episode'
      ? row.active_media_type
      : null,
    playbackProvider: typeof row.active_provider === 'string' ? row.active_provider : null,
    playbackProviderId: typeof row.active_provider_id === 'string' ? row.active_provider_id : null,
    playbackParentProvider: typeof row.active_parent_provider === 'string' ? row.active_parent_provider : null,
    playbackParentProviderId: typeof row.active_parent_provider_id === 'string' ? row.active_parent_provider_id : null,
    playbackSeasonNumber: row.active_season_number === null ? null : Number(row.active_season_number),
    playbackEpisodeNumber: row.active_episode_number === null ? null : Number(row.active_episode_number),
    playbackAbsoluteEpisodeNumber: null,
    detailsStillUrl: null,
    detailsReleaseYear: row.title_release_year === null ? null : Number(row.title_release_year),
    detailsRuntimeMinutes: row.title_runtime_minutes === null ? null : Number(row.title_runtime_minutes),
    detailsRating: row.title_rating === null ? null : Number(row.title_rating),
    episodeTitle: typeof row.active_episode_title === 'string' ? row.active_episode_title : null,
    episodeAirDate: requireOptionalIsoString(row.active_episode_release_at as Date | string | null | undefined),
    episodeRuntimeMinutes: null,
    episodeStillUrl: null,
  };
}

function requireOptionalIsoString(value: Date | string | null | undefined): string | null {
  return value ? requireDbIsoString(value, 'profile_title_projection.active_episode_release_at') : null;
}
