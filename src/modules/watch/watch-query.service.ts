import type { DbClient } from '../../lib/db.js';
import { requireDbIsoString } from '../../lib/time.js';
import { ProfileAccessService } from '../profiles/profile-access.service.js';
import { parseMediaKey } from '../identity/media-key.js';
import { ContinueWatchingRepository } from './continue-watching.repo.js';
import { WatchHistoryRepository } from './watch-history.repo.js';
import { WatchlistRepository } from './watchlist.repo.js';
import { RatingsRepository } from './ratings.repo.js';
import { MediaProgressRepository } from './media-progress.repo.js';

export type RawContinueWatchingRow = {
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

export type RawWatchHistoryRow = {
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
};

export type RawWatchlistRow = {
  mediaKey: string;
  mediaType: string;
  tmdbId: number | null;
  title: string | null;
  subtitle: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  addedAt: string;
  payload: Record<string, unknown>;
};

export type RawRatingRow = {
  mediaKey: string;
  mediaType: string;
  tmdbId: number | null;
  title: string | null;
  subtitle: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  rating: number;
  ratedAt: string;
  payload: Record<string, unknown>;
};

export type RawProgressRow = {
  positionSeconds: number;
  durationSeconds: number | null;
  progressPercent: number;
  status: string;
  lastPlayedAt: string;
};

function mapContinueWatchingRow(row: Record<string, unknown>): RawContinueWatchingRow {
  return {
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
    lastActivityAt: requireDbIsoString(row.last_activity_at as Date | string | null | undefined, 'continue_watching_projection.last_activity_at'),
    payload: (row.payload as Record<string, unknown> | undefined) ?? {},
  };
}

function mapWatchHistoryRow(row: Record<string, unknown>): RawWatchHistoryRow {
  return {
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
    watchedAt: requireDbIsoString(row.watched_at as Date | string | null | undefined, 'watch_history.watched_at'),
    payload: (row.payload as Record<string, unknown> | undefined) ?? {},
  };
}

function mapWatchlistRow(row: Record<string, unknown>): RawWatchlistRow {
  return {
    mediaKey: String(row.media_key),
    mediaType: String(row.media_type),
    tmdbId: row.tmdb_id === null ? null : Number(row.tmdb_id),
    title: typeof row.title === 'string' ? row.title : null,
    subtitle: typeof row.subtitle === 'string' ? row.subtitle : null,
    posterUrl: typeof row.poster_url === 'string' ? row.poster_url : null,
    backdropUrl: typeof row.backdrop_url === 'string' ? row.backdrop_url : null,
    addedAt: requireDbIsoString(row.added_at as Date | string | null | undefined, 'watchlist_items.added_at'),
    payload: (row.payload as Record<string, unknown> | undefined) ?? {},
  };
}

function mapRatingRow(row: Record<string, unknown>): RawRatingRow {
  return {
    mediaKey: String(row.media_key),
    mediaType: String(row.media_type),
    tmdbId: row.tmdb_id === null ? null : Number(row.tmdb_id),
    title: typeof row.title === 'string' ? row.title : null,
    subtitle: typeof row.subtitle === 'string' ? row.subtitle : null,
    posterUrl: typeof row.poster_url === 'string' ? row.poster_url : null,
    backdropUrl: typeof row.backdrop_url === 'string' ? row.backdrop_url : null,
    rating: Number(row.rating),
    ratedAt: requireDbIsoString(row.rated_at as Date | string | null | undefined, 'ratings.rated_at'),
    payload: (row.payload as Record<string, unknown> | undefined) ?? {},
  };
}

export class WatchQueryService {
  constructor(
    private readonly profileAccessService = new ProfileAccessService(),
    private readonly continueWatchingRepository = new ContinueWatchingRepository(),
    private readonly watchHistoryRepository = new WatchHistoryRepository(),
    private readonly watchlistRepository = new WatchlistRepository(),
    private readonly ratingsRepository = new RatingsRepository(),
    private readonly mediaProgressRepository = new MediaProgressRepository(),
  ) {}

  async listContinueWatching(client: DbClient, profileId: string, limit: number): Promise<RawContinueWatchingRow[]> {
    const rows = await this.continueWatchingRepository.list(client, profileId, limit);
    return rows.map(mapContinueWatchingRow);
  }

  async listWatchHistory(client: DbClient, profileId: string, limit: number): Promise<RawWatchHistoryRow[]> {
    const rows = await this.watchHistoryRepository.list(client, profileId, limit);
    return rows.map(mapWatchHistoryRow);
  }

  async listWatchlist(client: DbClient, profileId: string, limit: number): Promise<RawWatchlistRow[]> {
    const rows = await this.watchlistRepository.list(client, profileId, limit);
    return rows.map(mapWatchlistRow);
  }

  async listRatings(client: DbClient, profileId: string, limit: number): Promise<RawRatingRow[]> {
    const rows = await this.ratingsRepository.list(client, profileId, limit);
    return rows.map(mapRatingRow);
  }

  async getProgress(client: DbClient, profileId: string, mediaKey: string): Promise<RawProgressRow | null> {
    const result = await this.mediaProgressRepository.getByMediaKey(client, profileId, mediaKey);
    if (!result) {
      return null;
    }
    return {
      positionSeconds: result.positionSeconds,
      durationSeconds: result.durationSeconds,
      progressPercent: result.progressPercent,
      status: result.status,
      lastPlayedAt: result.lastPlayedAt,
    };
  }

  async getContinueWatchingByMediaKey(client: DbClient, profileId: string, mediaKey: string): Promise<RawContinueWatchingRow | null> {
    const row = await this.continueWatchingRepository.getByMediaKey(client, profileId, mediaKey);
    return row ? mapContinueWatchingRow(row) : null;
  }

  async getWatchHistoryByMediaKey(client: DbClient, profileId: string, mediaKey: string): Promise<RawWatchHistoryRow | null> {
    const row = await this.watchHistoryRepository.getByMediaKey(client, profileId, mediaKey);
    return row ? mapWatchHistoryRow(row) : null;
  }

  async getWatchlistByMediaKey(client: DbClient, profileId: string, mediaKey: string): Promise<RawWatchlistRow | null> {
    const row = await this.watchlistRepository.getByMediaKey(client, profileId, mediaKey);
    return row ? mapWatchlistRow(row) : null;
  }

  async getRatingByMediaKey(client: DbClient, profileId: string, mediaKey: string): Promise<RawRatingRow | null> {
    const row = await this.ratingsRepository.getByMediaKey(client, profileId, mediaKey);
    return row ? mapRatingRow(row) : null;
  }

  async listWatchedEpisodeKeysForShow(client: DbClient, profileId: string, trackedMediaKey: string): Promise<string[]> {
    const trackedIdentity = parseMediaKey(trackedMediaKey);
    if (trackedIdentity.mediaType !== 'show' && trackedIdentity.mediaType !== 'anime') {
      return [];
    }
    const set = await this.watchHistoryRepository.listWatchedEpisodeKeysForTrackedMedia(client, profileId, trackedMediaKey);
    return Array.from(set);
  }
}
