import { withDbClient, type DbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { MetadataViewService } from '../metadata/metadata-view.service.js';
import { ProfileRepository } from '../profiles/profile.repo.js';
import { ProfileSettingsRepository } from '../profiles/profile-settings.repo.js';
import { inferMediaIdentity } from '../watch/media-key.js';
import { TasteProfileRepository, type TasteProfileRecord } from './taste-profile.repo.js';
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

export type RecommendationTasteProfileInput = {
  sourceKey: string;
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
  sourceKey: string;
  historyGeneration: number;
  algorithmVersion: string;
  sourceCursor?: string | null;
  generatedAt: string;
  expiresAt?: string | null;
  source: string;
  updatedById?: string | null;
  sections: unknown[];
};

export class RecommendationOutputService {
  constructor(
    private readonly profileRepository = new ProfileRepository(),
    private readonly profileSettingsRepository = new ProfileSettingsRepository(),
    private readonly metadataViewService = new MetadataViewService(),
    private readonly tasteProfileRepository = new TasteProfileRepository(),
    private readonly snapshotsRepository = new RecommendationSnapshotsRepository(),
  ) {}

  async listTasteProfilesForAccount(accountId: string, profileId: string): Promise<TasteProfilePayload[]> {
    return withDbClient(async (client) => {
      await this.requireOwnedProfile(client, accountId, profileId);
      const rows = await this.tasteProfileRepository.listForProfile(client, profileId);
      return rows.map((row) => mapTasteProfile(row));
    });
  }

  async getTasteProfileForAccount(accountId: string, profileId: string, sourceKey: string): Promise<TasteProfilePayload | null> {
    return withDbClient(async (client) => {
      await this.requireOwnedProfile(client, accountId, profileId);
      const row = await this.tasteProfileRepository.findByProfileAndSourceKey(client, profileId, sourceKey);
      return row ? mapTasteProfile(row) : null;
    });
  }

  async upsertTasteProfileForAccount(accountId: string, profileId: string, input: RecommendationTasteProfileInput): Promise<TasteProfilePayload> {
    return withDbClient(async (client) => {
      await this.requireOwnedProfile(client, accountId, profileId);
      const row = await this.tasteProfileRepository.upsert(client, {
        profileId,
        sourceKey: input.sourceKey,
        genres: input.genres,
        preferredActors: input.preferredActors,
        preferredDirectors: input.preferredDirectors,
        contentTypePref: input.contentTypePref,
        ratingTendency: input.ratingTendency,
        decadePreferences: input.decadePreferences,
        watchingPace: input.watchingPace,
        aiSummary: input.aiSummary,
        source: input.source,
        updatedByKind: 'user',
        updatedById: accountId,
      });
      return mapTasteProfile(row);
    });
  }


  async getTasteProfileForAccountService(accountId: string, profileId: string, sourceKey: string): Promise<TasteProfilePayload | null> {
    return withDbClient(async (client) => {
      const targetProfileId = await this.requireOwnedProfileForAccount(client, accountId, profileId);
      const row = await this.tasteProfileRepository.findByProfileAndSourceKey(client, targetProfileId, sourceKey);
      return row ? mapTasteProfile(row) : null;
    });
  }

  async upsertTasteProfileForAccountService(
    accountId: string,
    profileId: string,
    input: RecommendationTasteProfileInput & { updatedById?: string | null },
  ): Promise<TasteProfilePayload> {
    return withDbClient(async (client) => {
      const targetProfileId = await this.requireOwnedProfileForAccount(client, accountId, profileId);
      const row = await this.tasteProfileRepository.upsert(client, {
        profileId: targetProfileId,
        sourceKey: input.sourceKey,
        genres: input.genres,
        preferredActors: input.preferredActors,
        preferredDirectors: input.preferredDirectors,
        contentTypePref: input.contentTypePref,
        ratingTendency: input.ratingTendency,
        decadePreferences: input.decadePreferences,
        watchingPace: input.watchingPace,
        aiSummary: input.aiSummary,
        source: input.source,
        updatedByKind: 'service',
        updatedById: input.updatedById ?? null,
      });
      return mapTasteProfile(row);
    });
  }

  async listRecommendationsForAccount(accountId: string, profileId: string): Promise<RecommendationSnapshotPayload[]> {
    return withDbClient(async (client) => {
      await this.requireOwnedProfile(client, accountId, profileId);
      const rows = await this.snapshotsRepository.listForProfile(client, profileId);
      return Promise.all(rows.map((row) => this.mapRecommendationSnapshot(client, row)));
    });
  }

  async getRecommendationsForAccount(
    accountId: string,
    profileId: string,
    sourceKey: string,
    algorithmVersion: string,
  ): Promise<RecommendationSnapshotPayload | null> {
    return withDbClient(async (client) => {
      await this.requireOwnedProfile(client, accountId, profileId);
      const row = await this.snapshotsRepository.findByProfileSourceAndAlgorithm(client, profileId, sourceKey, algorithmVersion);
      return row ? this.mapRecommendationSnapshot(client, row) : null;
    });
  }


  async upsertRecommendationsForAccount(
    accountId: string,
    profileId: string,
    input: RecommendationSnapshotInput,
  ): Promise<RecommendationSnapshotPayload> {
    return withDbClient(async (client) => {
      await this.requireOwnedProfile(client, accountId, profileId);
      const row = await this.snapshotsRepository.upsert(client, {
        profileId,
        sourceKey: input.sourceKey,
        historyGeneration: input.historyGeneration,
        algorithmVersion: input.algorithmVersion,
        sourceCursor: input.sourceCursor,
        generatedAt: input.generatedAt,
        expiresAt: input.expiresAt,
        items: input.sections,
        source: input.source,
        updatedByKind: 'user',
        updatedById: accountId,
      });
      return this.mapRecommendationSnapshot(client, row);
    });
  }


  async getRecommendationsForAccountService(
    accountId: string,
    profileId: string,
    sourceKey: string,
    algorithmVersion: string,
  ): Promise<RecommendationSnapshotPayload | null> {
    return withDbClient(async (client) => {
      const targetProfileId = await this.requireOwnedProfileForAccount(client, accountId, profileId);
      const row = await this.snapshotsRepository.findByProfileSourceAndAlgorithm(client, targetProfileId, sourceKey, algorithmVersion);
      return row ? this.mapRecommendationSnapshot(client, row) : null;
    });
  }

  async upsertRecommendationsForAccountService(
    accountId: string,
    profileId: string,
    input: RecommendationSnapshotInput,
  ): Promise<RecommendationSnapshotPayload> {
    return withDbClient(async (client) => {
      const targetProfileId = await this.requireOwnedProfileForAccount(client, accountId, profileId);
      const row = await this.snapshotsRepository.upsert(client, {
        profileId: targetProfileId,
        sourceKey: input.sourceKey,
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
      return this.mapRecommendationSnapshot(client, row);
    });
  }

  async getActiveSourceKeyForAccount(accountId: string, profileId: string): Promise<string | null> {
    return withDbClient(async (client) => {
      await this.requireOwnedProfile(client, accountId, profileId);
      return this.profileSettingsRepository.getActiveRecommenderSource(profileId, client);
    });
  }

  async setActiveSourceKeyForAccount(accountId: string, profileId: string, sourceKey: string): Promise<string> {
    return withDbClient(async (client) => {
      await this.requireOwnedProfile(client, accountId, profileId);
      await this.profileSettingsRepository.setActiveRecommenderSource(client, profileId, sourceKey);
      return sourceKey;
    });
  }

  async getActiveRecommendationForAccount(
    accountId: string,
    profileId: string,
    algorithmVersion: string,
  ): Promise<RecommendationSnapshotPayload | null> {
    return withDbClient(async (client) => {
      await this.requireOwnedProfile(client, accountId, profileId);
      const sourceKey = await this.profileSettingsRepository.getActiveRecommenderSource(profileId, client);
      if (!sourceKey) {
        return null;
      }
      const row = await this.snapshotsRepository.findByProfileSourceAndAlgorithm(client, profileId, sourceKey, algorithmVersion);
      return row ? this.mapRecommendationSnapshot(client, row) : null;
    });
  }

  async clearOutputsForProfile(client: DbClient, profileId: string): Promise<void> {
    await this.tasteProfileRepository.deleteForProfile(client, profileId);
    await this.snapshotsRepository.clearForProfile(client, profileId);
  }

  private async requireOwnedProfile(client: DbClient, accountId: string, profileId: string): Promise<void> {
    const profile = await this.profileRepository.findByIdForOwnerUser(client, profileId, accountId);
    if (!profile) {
      throw new HttpError(404, 'Profile not found.');
    }
  }

  private async requireOwnedProfileForAccount(client: DbClient, accountId: string, profileId: string): Promise<string> {
    const profile = await this.profileRepository.findByIdForOwnerUser(client, profileId, accountId);
    if (!profile) {
      throw new HttpError(404, 'Profile not found for account.');
    }
    return profile.id;
  }

  private async mapRecommendationSnapshot(client: DbClient, row: RecommendationSnapshotRecord): Promise<RecommendationSnapshotPayload> {
    const rawSections = Array.isArray(row.items) ? row.items : [];
    const sections = await Promise.all(rawSections.map((section) => this.mapRecommendationSection(client, section)));
    return {
      profileId: row.profileId,
      sourceKey: row.sourceKey,
      historyGeneration: row.historyGeneration,
      algorithmVersion: row.algorithmVersion,
      sourceCursor: row.sourceCursor,
      generatedAt: row.generatedAt,
      expiresAt: row.expiresAt,
      source: row.source,
      updatedByKind: row.updatedByKind,
      updatedById: row.updatedById,
      sections,
      updatedAt: row.updatedAt,
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
      media: await this.metadataViewService.buildMetadataCardView(client, inferMediaIdentity({
        mediaKey: typeof row.mediaKey === 'string' ? row.mediaKey : typeof row.media_key === 'string' ? row.media_key : undefined,
        mediaType: typeof row.mediaType === 'string' ? row.mediaType : typeof row.media_type === 'string' ? row.media_type : 'movie',
        tmdbId: typeof row.tmdbId === 'number' ? row.tmdbId : typeof row.tmdb_id === 'number' ? row.tmdb_id : null,
        showTmdbId: typeof row.showTmdbId === 'number' ? row.showTmdbId : typeof row.show_tmdb_id === 'number' ? row.show_tmdb_id : null,
        seasonNumber: typeof row.seasonNumber === 'number' ? row.seasonNumber : typeof row.season_number === 'number' ? row.season_number : null,
        episodeNumber: typeof row.episodeNumber === 'number' ? row.episodeNumber : typeof row.episode_number === 'number' ? row.episode_number : null,
      })),
      reason: typeof row.reason === 'string' ? row.reason : null,
      score: typeof row.score === 'number' ? row.score : null,
      rank: typeof row.rank === 'number' ? row.rank : index + 1,
      payload: asRecord(row.payload),
    };
  }
}

function mapTasteProfile(row: TasteProfileRecord): TasteProfilePayload {
  return {
    profileId: row.profileId,
    sourceKey: row.sourceKey,
    genres: row.genres,
    preferredActors: row.preferredActors,
    preferredDirectors: row.preferredDirectors,
    contentTypePref: row.contentTypePref,
    ratingTendency: row.ratingTendency,
    decadePreferences: row.decadePreferences,
    watchingPace: row.watchingPace,
    aiSummary: row.aiSummary,
    source: row.source,
    updatedByKind: row.updatedByKind,
    updatedById: row.updatedById,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
