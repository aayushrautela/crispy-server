import { withDbClient, type DbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { requireDbIsoString } from '../../lib/time.js';
import { MetadataViewService } from '../metadata/metadata-view.service.js';
import type { MetadataCardView } from '../metadata/metadata.types.js';
import { ProfileRepository, type ProfileRecord } from '../profiles/profile.repo.js';
import { inferMediaIdentity } from '../watch/media-key.js';
import { ContinueWatchingRepository } from '../watch/continue-watching.repo.js';
import { RatingsRepository } from '../watch/ratings.repo.js';
import { TrackedSeriesRepository } from '../watch/tracked-series.repo.js';
import { WatchHistoryRepository } from '../watch/watch-history.repo.js';
import { WatchlistRepository } from '../watch/watchlist.repo.js';

export type RecommendationDataListKind = 'watch-history' | 'continue-watching' | 'watchlist' | 'ratings' | 'tracked-series';

type ProfileSummary = {
  id: string;
  accountId: string | null;
  name: string;
  isKids: boolean;
  updatedAt: string;
};

type HydratedMedia = MetadataCardView;

export class RecommendationDataService {
  constructor(
    private readonly profileRepository = new ProfileRepository(),
    private readonly metadataViewService = new MetadataViewService(),
    private readonly watchHistoryRepository = new WatchHistoryRepository(),
    private readonly continueWatchingRepository = new ContinueWatchingRepository(),
    private readonly watchlistRepository = new WatchlistRepository(),
    private readonly ratingsRepository = new RatingsRepository(),
    private readonly trackedSeriesRepository = new TrackedSeriesRepository(),
  ) {}

  async listAccountProfiles(accountId: string): Promise<ProfileSummary[]> {
    return withDbClient(async (client) => {
      const profiles = await this.profileRepository.listForOwnerUser(client, accountId);
      return Promise.all(profiles.map((profile) => toProfileSummary(this.profileRepository, client, profile)));
    });
  }

  async listAccountProfilesForService(accountId: string): Promise<ProfileSummary[]> {
    return withDbClient(async (client) => {
      const profiles = await this.profileRepository.listForOwnerUser(client, accountId);
      return Promise.all(profiles.map((profile) => toProfileSummary(this.profileRepository, client, profile)));
    });
  }

  async getWatchHistoryForAccount(accountId: string, profileId: string, limit: number) {
    return withDbClient(async (client) => {
      await this.requireOwnedProfile(client, accountId, profileId);
      const rows = await this.watchHistoryRepository.list(client, profileId, limit);
      return Promise.all(rows.map(async (row) => ({
        media: await this.buildMedia(client, row),
        watchedAt: requireDbIsoString(row.watched_at as Date | string | null | undefined, 'watch_history.watched_at'),
        payload: asRecord(row.payload),
      })));
    });
  }

  async getWatchHistoryForAccountService(accountId: string, profileId: string, limit: number) {
    return withDbClient(async (client) => {
      const targetProfileId = await this.resolveOwnedProfileId(client, accountId, profileId);
      const rows = await this.watchHistoryRepository.list(client, targetProfileId, limit);
      return Promise.all(rows.map(async (row) => ({
        media: await this.buildMedia(client, row),
        watchedAt: requireDbIsoString(row.watched_at as Date | string | null | undefined, 'watch_history.watched_at'),
        payload: asRecord(row.payload),
      })));
    });
  }

  async getContinueWatchingForAccount(accountId: string, profileId: string, limit: number) {
    return withDbClient(async (client) => {
      await this.requireOwnedProfile(client, accountId, profileId);
      const rows = await this.continueWatchingRepository.list(client, profileId, limit);
      return Promise.all(rows.map(async (row) => ({
        id: typeof row.id === 'string' ? row.id : String(row.id),
        media: await this.buildMedia(client, row),
        progress: {
          positionSeconds: row.position_seconds === null ? null : Number(row.position_seconds),
          durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
          progressPercent: Number(row.progress_percent ?? 0),
          lastPlayedAt: requireDbIsoString(row.last_activity_at as Date | string | null | undefined, 'continue_watching_projection.last_activity_at'),
        },
        lastActivityAt: requireDbIsoString(row.last_activity_at as Date | string | null | undefined, 'continue_watching_projection.last_activity_at'),
        payload: asRecord(row.payload),
      })));
    });
  }

  async getContinueWatchingForAccountService(accountId: string, profileId: string, limit: number) {
    return withDbClient(async (client) => {
      const targetProfileId = await this.resolveOwnedProfileId(client, accountId, profileId);
      const rows = await this.continueWatchingRepository.list(client, targetProfileId, limit);
      return Promise.all(rows.map(async (row) => ({
        id: typeof row.id === 'string' ? row.id : String(row.id),
        media: await this.buildMedia(client, row),
        progress: {
          positionSeconds: row.position_seconds === null ? null : Number(row.position_seconds),
          durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
          progressPercent: Number(row.progress_percent ?? 0),
          lastPlayedAt: requireDbIsoString(row.last_activity_at as Date | string | null | undefined, 'continue_watching_projection.last_activity_at'),
        },
        lastActivityAt: requireDbIsoString(row.last_activity_at as Date | string | null | undefined, 'continue_watching_projection.last_activity_at'),
        payload: asRecord(row.payload),
      })));
    });
  }

  async getWatchlistForAccount(accountId: string, profileId: string, limit: number) {
    return withDbClient(async (client) => {
      await this.requireOwnedProfile(client, accountId, profileId);
      const rows = await this.watchlistRepository.list(client, profileId, limit);
      return Promise.all(rows.map(async (row) => ({
        media: await this.buildMedia(client, row),
        addedAt: requireDbIsoString(row.added_at as Date | string | null | undefined, 'watchlist_items.added_at'),
        payload: asRecord(row.payload),
      })));
    });
  }

  async getWatchlistForAccountService(accountId: string, profileId: string, limit: number) {
    return withDbClient(async (client) => {
      const targetProfileId = await this.resolveOwnedProfileId(client, accountId, profileId);
      const rows = await this.watchlistRepository.list(client, targetProfileId, limit);
      return Promise.all(rows.map(async (row) => ({
        media: await this.buildMedia(client, row),
        addedAt: requireDbIsoString(row.added_at as Date | string | null | undefined, 'watchlist_items.added_at'),
        payload: asRecord(row.payload),
      })));
    });
  }

  async getRatingsForAccount(accountId: string, profileId: string, limit: number) {
    return withDbClient(async (client) => {
      await this.requireOwnedProfile(client, accountId, profileId);
      const rows = await this.ratingsRepository.list(client, profileId, limit);
      return Promise.all(rows.map(async (row) => ({
        media: await this.buildMedia(client, row),
        rating: {
          value: Number(row.rating),
          ratedAt: requireDbIsoString(row.rated_at as Date | string | null | undefined, 'ratings.rated_at'),
        },
        payload: asRecord(row.payload),
      })));
    });
  }

  async getRatingsForAccountService(accountId: string, profileId: string, limit: number) {
    return withDbClient(async (client) => {
      const targetProfileId = await this.resolveOwnedProfileId(client, accountId, profileId);
      const rows = await this.ratingsRepository.list(client, targetProfileId, limit);
      return Promise.all(rows.map(async (row) => ({
        media: await this.buildMedia(client, row),
        rating: {
          value: Number(row.rating),
          ratedAt: requireDbIsoString(row.rated_at as Date | string | null | undefined, 'ratings.rated_at'),
        },
        payload: asRecord(row.payload),
      })));
    });
  }

  async getTrackedSeriesForAccount(accountId: string, profileId: string, limit: number) {
    return withDbClient(async (client) => {
      await this.requireOwnedProfile(client, accountId, profileId);
      return this.loadTrackedSeries(client, profileId, limit);
    });
  }

  async getTrackedSeriesForAccountService(accountId: string, profileId: string, limit: number) {
    return withDbClient(async (client) => {
      const targetProfileId = await this.resolveOwnedProfileId(client, accountId, profileId);
      return this.loadTrackedSeries(client, targetProfileId, limit);
    });
  }

  private async requireOwnedProfile(client: DbClient, accountId: string, profileId: string): Promise<void> {
    const profile = await this.profileRepository.findByIdForOwnerUser(client, profileId, accountId);
    if (!profile) {
      throw new HttpError(404, 'Profile not found.');
    }
  }

  private async resolveOwnedProfileId(client: DbClient, accountId: string, profileId: string): Promise<string> {
    const profile = await this.profileRepository.findByIdForOwnerUser(client, profileId, accountId);
    if (!profile) {
      throw new HttpError(404, 'Profile not found for account.');
    }
    return profile.id;
  }

  private async loadTrackedSeries(client: DbClient, profileId: string, limit: number) {
    const rows = await this.trackedSeriesRepository.listForProfile(client, profileId, limit);
    return Promise.all(rows.map(async (row) => ({
      show: await this.metadataViewService.buildMetadataCardView(client, inferMediaIdentity({
        mediaKey: row.trackedMediaKey,
        mediaType: row.trackedMediaType,
        provider: row.provider,
        providerId: row.providerId,
      })),
      reason: row.reason,
      lastInteractedAt: row.lastInteractedAt,
      nextEpisodeAirDate: row.nextEpisodeAirDate,
      metadataRefreshedAt: row.metadataRefreshedAt,
      payload: row.payload,
    })));
  }

  private async buildMedia(client: DbClient, row: Record<string, unknown>): Promise<HydratedMedia> {
    return this.metadataViewService.buildMetadataCardViewFromRow(client, {
      media_key:
        typeof row.media_key === 'string'
          ? row.media_key
          : typeof row.mediaKey === 'string'
            ? row.mediaKey
            : null,
      media_type:
        typeof row.media_type === 'string'
          ? row.media_type
          : typeof row.mediaType === 'string'
            ? row.mediaType
            : 'movie',
      tmdb_id:
        typeof row.tmdb_id === 'number'
          ? row.tmdb_id
          : typeof row.tmdbId === 'number'
            ? row.tmdbId
            : null,
      show_tmdb_id:
        typeof row.show_tmdb_id === 'number'
          ? row.show_tmdb_id
          : typeof row.showTmdbId === 'number'
            ? row.showTmdbId
            : null,
      season_number:
        typeof row.season_number === 'number'
          ? row.season_number
          : typeof row.seasonNumber === 'number'
            ? row.seasonNumber
            : null,
      episode_number:
        typeof row.episode_number === 'number'
          ? row.episode_number
          : typeof row.episodeNumber === 'number'
            ? row.episodeNumber
            : null,
      title:
        typeof row.title === 'string'
          ? row.title
          : null,
      subtitle:
        typeof row.subtitle === 'string'
          ? row.subtitle
          : null,
      poster_url:
        typeof row.poster_url === 'string'
          ? row.poster_url
          : null,
      backdrop_url:
        typeof row.backdrop_url === 'string'
          ? row.backdrop_url
          : null,
    });
  }
}

async function toProfileSummary(
  profileRepository: ProfileRepository,
  client: DbClient,
  profile: ProfileRecord,
): Promise<ProfileSummary> {
  const accountId = await profileRepository.findOwnerUserIdById(client, profile.id);
  return {
    id: profile.id,
    accountId,
    name: profile.name,
    isKids: profile.isKids,
    updatedAt: profile.updatedAt,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
