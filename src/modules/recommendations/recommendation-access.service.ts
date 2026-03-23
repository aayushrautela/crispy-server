import { withTransaction, type DbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { MetadataViewService } from '../metadata/metadata-view.service.js';
import { inferMediaIdentity } from '../watch/media-key.js';
import { ContinueWatchingRepository } from '../watch/continue-watching.repo.js';
import { RatingsRepository } from '../watch/ratings.repo.js';
import { TrackedSeriesRepository } from '../watch/tracked-series.repo.js';
import { WatchHistoryRepository } from '../watch/watch-history.repo.js';
import { WatchlistRepository } from '../watch/watchlist.repo.js';
import { ProfileRepository, type ProfileRecord } from '../profiles/profile.repo.js';
import { TasteProfileRepository, type TasteProfileRecord } from './taste-profile.repo.js';
import { RecommendationEventOutboxRepository } from './recommendation-event-outbox.repo.js';
import {
  RecommendationSnapshotsRepository,
  type RecommendationSnapshotRecord,
} from './recommendation-snapshots.repo.js';
import type {
  RecommendationSection,
  RecommendationSectionItem,
  RecommendationSnapshotPayload,
  TasteProfilePayload,
} from './recommendation.types.js';

type ProfileSummary = {
  id: string;
  householdId: string;
  name: string;
  isKids: boolean;
  updatedAt: string;
};

type HydratedHistoryItem = {
  media: Awaited<ReturnType<MetadataViewService['buildMetadataView']>>;
  watchedAt: string;
  payload: Record<string, unknown>;
};

type HydratedContinueWatchingItem = {
  media: Awaited<ReturnType<MetadataViewService['buildMetadataView']>>;
  progress: {
    positionSeconds: number | null;
    durationSeconds: number | null;
    progressPercent: number;
    lastPlayedAt: string;
  };
  lastActivityAt: string;
  payload: Record<string, unknown>;
};

type HydratedWatchlistItem = {
  media: Awaited<ReturnType<MetadataViewService['buildMetadataView']>>;
  addedAt: string;
  payload: Record<string, unknown>;
};

type HydratedRatingItem = {
  media: Awaited<ReturnType<MetadataViewService['buildMetadataView']>>;
  rating: {
    value: number;
    ratedAt: string;
  };
  payload: Record<string, unknown>;
};

type HydratedTrackedSeriesItem = {
  show: Awaited<ReturnType<MetadataViewService['buildMetadataView']>>;
  reason: string;
  lastInteractedAt: string;
  nextEpisodeAirDate: string | null;
  metadataRefreshedAt: string | null;
  payload: Record<string, unknown>;
};

export type RecommendationTasteProfileInput = {
  genres?: unknown[];
  preferredActors?: unknown[];
  preferredDirectors?: unknown[];
  contentTypePref?: Record<string, unknown>;
  ratingTendency?: Record<string, unknown>;
  decadePreferences?: unknown[];
  watchingPace?: string | null;
  aiSummary?: string | null;
  source: string;
};

export type RecommendationSnapshotInput = {
  historyGeneration: number;
  algorithmVersion: string;
  sourceCursor?: string | null;
  generatedAt: string;
  expiresAt?: string | null;
  source: string;
  updatedById?: string | null;
  sections: unknown[];
};

export class RecommendationAccessService {
  constructor(
    private readonly profileRepository = new ProfileRepository(),
    private readonly metadataViewService = new MetadataViewService(),
    private readonly watchHistoryRepository = new WatchHistoryRepository(),
    private readonly continueWatchingRepository = new ContinueWatchingRepository(),
    private readonly watchlistRepository = new WatchlistRepository(),
    private readonly ratingsRepository = new RatingsRepository(),
    private readonly trackedSeriesRepository = new TrackedSeriesRepository(),
    private readonly outboxRepository = new RecommendationEventOutboxRepository(),
    private readonly snapshotsRepository = new RecommendationSnapshotsRepository(),
    private readonly tasteProfileRepository = new TasteProfileRepository(),
  ) {}

  async listOwnedProfiles(userId: string): Promise<ProfileSummary[]> {
    return withTransaction(async (client) => {
      const profiles = await this.profileRepository.listForUser(client, userId);
      return profiles.map((profile) => toProfileSummary(profile));
    });
  }

  async listAllProfiles(limit: number, offset: number): Promise<{ profiles: ProfileSummary[] }> {
    return withTransaction(async (client) => {
      const profiles = await this.profileRepository.listAll(client, limit, offset);
      return { profiles: profiles.map((profile) => toProfileSummary(profile)) };
    });
  }

  async getWatchHistoryForUser(userId: string, profileId: string, limit: number): Promise<HydratedHistoryItem[]> {
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

  async getWatchHistoryForService(profileId: string, limit: number): Promise<HydratedHistoryItem[]> {
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

  async getContinueWatchingForUser(userId: string, profileId: string, limit: number): Promise<HydratedContinueWatchingItem[]> {
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

  async getContinueWatchingForService(profileId: string, limit: number): Promise<HydratedContinueWatchingItem[]> {
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

  async getWatchlistForUser(userId: string, profileId: string, limit: number): Promise<HydratedWatchlistItem[]> {
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

  async getWatchlistForService(profileId: string, limit: number): Promise<HydratedWatchlistItem[]> {
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

  async getRatingsForUser(userId: string, profileId: string, limit: number): Promise<HydratedRatingItem[]> {
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

  async getRatingsForService(profileId: string, limit: number): Promise<HydratedRatingItem[]> {
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

  async getTrackedSeriesForUser(userId: string, profileId: string, limit: number): Promise<HydratedTrackedSeriesItem[]> {
    return withTransaction(async (client) => {
      await this.requireOwnedProfile(client, userId, profileId);
      return this.loadTrackedSeries(client, profileId, limit);
    });
  }

  async getTrackedSeriesForService(profileId: string, limit: number): Promise<HydratedTrackedSeriesItem[]> {
    return withTransaction(async (client) => {
      await this.requireExistingProfile(client, profileId);
      return this.loadTrackedSeries(client, profileId, limit);
    });
  }

  async getOutboxEvents(profileId: string, afterId: number | null, limit: number) {
    return withTransaction(async (client) => {
      await this.requireExistingProfile(client, profileId);
      return this.outboxRepository.listUndeliveredForProfile(client, { profileId, afterId, limit });
    });
  }

  async markOutboxDelivered(profileId: string, ids: number[]) {
    return withTransaction(async (client) => {
      await this.requireExistingProfile(client, profileId);
      return {
        updated: await this.outboxRepository.markDelivered(client, { profileId, ids }),
      };
    });
  }

  async getTasteProfileForUser(userId: string, profileId: string): Promise<TasteProfilePayload | null> {
    return withTransaction(async (client) => {
      await this.requireOwnedProfile(client, userId, profileId);
      const record = await this.tasteProfileRepository.findByProfileId(client, profileId);
      return record ? mapTasteProfile(record) : null;
    });
  }

  async getTasteProfileForService(profileId: string): Promise<TasteProfilePayload | null> {
    return withTransaction(async (client) => {
      await this.requireExistingProfile(client, profileId);
      const record = await this.tasteProfileRepository.findByProfileId(client, profileId);
      return record ? mapTasteProfile(record) : null;
    });
  }

  async upsertTasteProfileForUser(userId: string, profileId: string, input: RecommendationTasteProfileInput): Promise<TasteProfilePayload> {
    return withTransaction(async (client) => {
      await this.requireOwnedProfile(client, userId, profileId);
      const record = await this.tasteProfileRepository.upsert(client, {
        profileId,
        ...input,
        updatedByKind: 'user',
        updatedById: userId,
      });
      return mapTasteProfile(record);
    });
  }

  async upsertTasteProfileForService(
    profileId: string,
    input: RecommendationTasteProfileInput & { updatedById?: string | null },
  ): Promise<TasteProfilePayload> {
    return withTransaction(async (client) => {
      await this.requireExistingProfile(client, profileId);
      const record = await this.tasteProfileRepository.upsert(client, {
        profileId,
        ...input,
        updatedByKind: 'service',
      });
      return mapTasteProfile(record);
    });
  }

  async getRecommendationsForUser(
    userId: string,
    profileId: string,
    algorithmVersion: string,
  ): Promise<RecommendationSnapshotPayload | null> {
    return withTransaction(async (client) => {
      await this.requireOwnedProfile(client, userId, profileId);
      const record = await this.snapshotsRepository.findByProfileAndAlgorithm(client, profileId, algorithmVersion);
      return record ? this.mapRecommendationSnapshot(client, record) : null;
    });
  }

  async getRecommendationsForService(profileId: string, algorithmVersion: string): Promise<RecommendationSnapshotPayload | null> {
    return withTransaction(async (client) => {
      await this.requireExistingProfile(client, profileId);
      const record = await this.snapshotsRepository.findByProfileAndAlgorithm(client, profileId, algorithmVersion);
      return record ? this.mapRecommendationSnapshot(client, record) : null;
    });
  }

  async upsertRecommendationsForUser(
    userId: string,
    profileId: string,
    input: RecommendationSnapshotInput,
  ): Promise<RecommendationSnapshotPayload> {
    return withTransaction(async (client) => {
      await this.requireOwnedProfile(client, userId, profileId);
      const record = await this.snapshotsRepository.upsert(client, {
        profileId,
        historyGeneration: input.historyGeneration,
        algorithmVersion: input.algorithmVersion,
        sourceCursor: input.sourceCursor,
        generatedAt: input.generatedAt,
        expiresAt: input.expiresAt,
        items: input.sections,
        source: input.source,
        updatedByKind: 'user',
        updatedById: userId,
      });
      return this.mapRecommendationSnapshot(client, record);
    });
  }

  async upsertRecommendationsForService(profileId: string, input: RecommendationSnapshotInput): Promise<RecommendationSnapshotPayload> {
    return withTransaction(async (client) => {
      await this.requireExistingProfile(client, profileId);
      const record = await this.snapshotsRepository.upsert(client, {
        profileId,
        historyGeneration: input.historyGeneration,
        algorithmVersion: input.algorithmVersion,
        sourceCursor: input.sourceCursor,
        generatedAt: input.generatedAt,
        expiresAt: input.expiresAt,
        items: input.sections,
        source: input.source,
        updatedByKind: 'service',
        updatedById: input.updatedById ?? null,
      });
      return this.mapRecommendationSnapshot(client, record);
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

  private async loadTrackedSeries(client: DbClient, profileId: string, limit: number): Promise<HydratedTrackedSeriesItem[]> {
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

  private async buildMedia(client: DbClient, row: Record<string, unknown>) {
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

  private async mapRecommendationSnapshot(
    client: DbClient,
    record: RecommendationSnapshotRecord,
  ): Promise<RecommendationSnapshotPayload> {
    const rawSections = Array.isArray(record.items) ? record.items : [];
    const sections = await Promise.all(rawSections.map((section) => this.mapRecommendationSection(client, section)));
    return {
      profileId: record.profileId,
      historyGeneration: record.historyGeneration,
      algorithmVersion: record.algorithmVersion,
      sourceCursor: record.sourceCursor,
      generatedAt: record.generatedAt,
      expiresAt: record.expiresAt,
      source: record.source,
      updatedByKind: record.updatedByKind,
      updatedById: record.updatedById,
      sections,
      updatedAt: record.updatedAt,
    };
  }

  private async mapRecommendationSection(client: DbClient, value: unknown): Promise<RecommendationSection> {
    const row = asRecord(value);
    const rawItems = Array.isArray(row.items) ? row.items : [];
    const items = await Promise.all(rawItems.map((item, index) => this.mapRecommendationItem(client, item, index)));
    return {
      id: typeof row.id === 'string' ? row.id : 'recommended',
      title: typeof row.title === 'string' ? row.title : 'Recommended',
      items,
      meta: asRecord(row.meta),
    };
  }

  private async mapRecommendationItem(client: DbClient, value: unknown, index: number): Promise<RecommendationSectionItem> {
    const row = asRecord(value);
    return {
      media: await this.buildMedia(client, row),
      reason: typeof row.reason === 'string' ? row.reason : null,
      score: typeof row.score === 'number' ? row.score : null,
      rank: typeof row.rank === 'number' ? row.rank : index + 1,
      payload: asRecord(row.payload),
    };
  }
}

function toProfileSummary(profile: ProfileRecord): ProfileSummary {
  return {
    id: profile.id,
    householdId: profile.householdId,
    name: profile.name,
    isKids: profile.isKids,
    updatedAt: profile.updatedAt,
  };
}

function mapTasteProfile(record: TasteProfileRecord): TasteProfilePayload {
  return {
    genres: record.genres,
    preferredActors: record.preferredActors,
    preferredDirectors: record.preferredDirectors,
    contentTypePref: record.contentTypePref,
    ratingTendency: record.ratingTendency,
    decadePreferences: record.decadePreferences,
    watchingPace: record.watchingPace,
    aiSummary: record.aiSummary,
    source: record.source,
    updatedByKind: record.updatedByKind,
    updatedById: record.updatedById,
    version: record.version,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
