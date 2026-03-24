import { withTransaction, type DbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { MetadataViewService } from '../metadata/metadata-view.service.js';
import { ProfileRepository, type ProfileRecord } from '../profiles/profile.repo.js';
import { inferMediaIdentity } from '../watch/media-key.js';
import { ContinueWatchingRepository } from '../watch/continue-watching.repo.js';
import { RatingsRepository } from '../watch/ratings.repo.js';
import { TrackedSeriesRepository } from '../watch/tracked-series.repo.js';
import { WatchHistoryRepository } from '../watch/watch-history.repo.js';
import { WatchlistRepository } from '../watch/watchlist.repo.js';

type ProfileSummary = {
  id: string;
  accountId: string | null;
  name: string;
  isKids: boolean;
  updatedAt: string;
};

type HydratedMedia = Awaited<ReturnType<MetadataViewService['buildMetadataView']>>;

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

  async listOwnedProfiles(userId: string): Promise<ProfileSummary[]> {
    return withTransaction(async (client) => {
      const profiles = await this.profileRepository.listForUser(client, userId);
      return Promise.all(profiles.map((profile) => toProfileSummary(this.profileRepository, client, profile)));
    });
  }

  async listAllProfiles(limit: number, offset: number): Promise<{ profiles: ProfileSummary[] }> {
    return withTransaction(async (client) => {
      const profiles = await this.profileRepository.listAll(client, limit, offset);
      return {
        profiles: await Promise.all(profiles.map((profile) => toProfileSummary(this.profileRepository, client, profile))),
      };
    });
  }

  async getWatchHistoryForUser(userId: string, profileId: string, limit: number) {
    return withTransaction(async (client) => {
      await this.requireOwnedProfile(client, userId, profileId);
      const rows = await this.watchHistoryRepository.list(client, profileId, limit);
      return Promise.all(rows.map(async (row) => ({
        media: await this.buildMedia(client, row),
        watchedAt: String(row.watched_at),
        payload: asRecord(row.payload),
      })));
    });
  }

  async getWatchHistoryForService(profileId: string, limit: number) {
    return withTransaction(async (client) => {
      await this.requireExistingProfile(client, profileId);
      const rows = await this.watchHistoryRepository.list(client, profileId, limit);
      return Promise.all(rows.map(async (row) => ({
        media: await this.buildMedia(client, row),
        watchedAt: String(row.watched_at),
        payload: asRecord(row.payload),
      })));
    });
  }

  async getContinueWatchingForUser(userId: string, profileId: string, limit: number) {
    return withTransaction(async (client) => {
      await this.requireOwnedProfile(client, userId, profileId);
      const rows = await this.continueWatchingRepository.list(client, profileId, limit);
      return Promise.all(rows.map(async (row) => ({
        media: await this.buildMedia(client, row),
        progress: {
          positionSeconds: row.position_seconds === null ? null : Number(row.position_seconds),
          durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
          progressPercent: Number(row.progress_percent ?? 0),
          lastPlayedAt: String(row.last_activity_at),
        },
        lastActivityAt: String(row.last_activity_at),
        payload: asRecord(row.payload),
      })));
    });
  }

  async getContinueWatchingForService(profileId: string, limit: number) {
    return withTransaction(async (client) => {
      await this.requireExistingProfile(client, profileId);
      const rows = await this.continueWatchingRepository.list(client, profileId, limit);
      return Promise.all(rows.map(async (row) => ({
        media: await this.buildMedia(client, row),
        progress: {
          positionSeconds: row.position_seconds === null ? null : Number(row.position_seconds),
          durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
          progressPercent: Number(row.progress_percent ?? 0),
          lastPlayedAt: String(row.last_activity_at),
        },
        lastActivityAt: String(row.last_activity_at),
        payload: asRecord(row.payload),
      })));
    });
  }

  async getWatchlistForUser(userId: string, profileId: string, limit: number) {
    return withTransaction(async (client) => {
      await this.requireOwnedProfile(client, userId, profileId);
      const rows = await this.watchlistRepository.list(client, profileId, limit);
      return Promise.all(rows.map(async (row) => ({
        media: await this.buildMedia(client, row),
        addedAt: String(row.added_at),
        payload: asRecord(row.payload),
      })));
    });
  }

  async getWatchlistForService(profileId: string, limit: number) {
    return withTransaction(async (client) => {
      await this.requireExistingProfile(client, profileId);
      const rows = await this.watchlistRepository.list(client, profileId, limit);
      return Promise.all(rows.map(async (row) => ({
        media: await this.buildMedia(client, row),
        addedAt: String(row.added_at),
        payload: asRecord(row.payload),
      })));
    });
  }

  async getRatingsForUser(userId: string, profileId: string, limit: number) {
    return withTransaction(async (client) => {
      await this.requireOwnedProfile(client, userId, profileId);
      const rows = await this.ratingsRepository.list(client, profileId, limit);
      return Promise.all(rows.map(async (row) => ({
        media: await this.buildMedia(client, row),
        rating: {
          value: Number(row.rating),
          ratedAt: String(row.rated_at),
        },
        payload: asRecord(row.payload),
      })));
    });
  }

  async getRatingsForService(profileId: string, limit: number) {
    return withTransaction(async (client) => {
      await this.requireExistingProfile(client, profileId);
      const rows = await this.ratingsRepository.list(client, profileId, limit);
      return Promise.all(rows.map(async (row) => ({
        media: await this.buildMedia(client, row),
        rating: {
          value: Number(row.rating),
          ratedAt: String(row.rated_at),
        },
        payload: asRecord(row.payload),
      })));
    });
  }

  async getTrackedSeriesForUser(userId: string, profileId: string, limit: number) {
    return withTransaction(async (client) => {
      await this.requireOwnedProfile(client, userId, profileId);
      return this.loadTrackedSeries(client, profileId, limit);
    });
  }

  async getTrackedSeriesForService(profileId: string, limit: number) {
    return withTransaction(async (client) => {
      await this.requireExistingProfile(client, profileId);
      return this.loadTrackedSeries(client, profileId, limit);
    });
  }

  private async requireOwnedProfile(client: DbClient, userId: string, profileId: string): Promise<void> {
    const profile = await this.profileRepository.findByIdForUser(client, profileId, userId);
    if (!profile) {
      throw new HttpError(404, 'Profile not found.');
    }
  }

  private async requireExistingProfile(client: DbClient, profileId: string): Promise<void> {
    const profile = await this.profileRepository.findById(client, profileId);
    if (!profile) {
      throw new HttpError(404, 'Profile not found.');
    }
  }

  private async loadTrackedSeries(client: DbClient, profileId: string, limit: number) {
    const rows = await this.trackedSeriesRepository.listForProfile(client, profileId, limit);
    return Promise.all(rows.map(async (row) => ({
      show: await this.metadataViewService.buildMetadataView(client, inferMediaIdentity({ mediaType: 'show', tmdbId: row.showTmdbId })),
      reason: row.reason,
      lastInteractedAt: row.lastInteractedAt,
      nextEpisodeAirDate: row.nextEpisodeAirDate,
      metadataRefreshedAt: row.metadataRefreshedAt,
      payload: row.payload,
    })));
  }

  private async buildMedia(client: DbClient, row: Record<string, unknown>): Promise<HydratedMedia> {
    return this.metadataViewService.buildMetadataView(
      client,
      inferMediaIdentity({
        mediaKey:
          typeof row.media_key === 'string'
            ? row.media_key
            : typeof row.mediaKey === 'string'
              ? row.mediaKey
              : undefined,
        mediaType:
          typeof row.media_type === 'string'
            ? row.media_type
            : typeof row.mediaType === 'string'
              ? row.mediaType
              : 'movie',
        tmdbId:
          typeof row.tmdb_id === 'number'
            ? row.tmdb_id
            : typeof row.tmdbId === 'number'
              ? row.tmdbId
              : null,
        showTmdbId:
          typeof row.show_tmdb_id === 'number'
            ? row.show_tmdb_id
            : typeof row.showTmdbId === 'number'
              ? row.showTmdbId
              : null,
        seasonNumber:
          typeof row.season_number === 'number'
            ? row.season_number
            : typeof row.seasonNumber === 'number'
              ? row.seasonNumber
              : null,
        episodeNumber:
          typeof row.episode_number === 'number'
            ? row.episode_number
            : typeof row.episodeNumber === 'number'
              ? row.episodeNumber
              : null,
      }),
    );
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
