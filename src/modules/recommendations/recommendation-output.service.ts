import { withDbClient, type DbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { MetadataCardService } from '../metadata/metadata-card.service.js';
import { ProfileAccessService } from '../profiles/profile-access.service.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { assertPublicItemId } from '../identity/public-item-id.js';
import type { MetadataCardView } from '../metadata/metadata-card.types.js';
import { TasteProfileRepository, type TasteProfileRecord } from './taste-profile.repo.js';
import {
  RecommendationSnapshotsRepository,
  type RecommendationSnapshotRecord,
} from './recommendation-snapshots.repo.js';
import { recommendationConfig } from './recommendation-config.js';
import type {
  RecommendationHomePayload,
  RecommendationSection,
  RecommendationSnapshotPayload,
  TasteProfilePayload,
} from './recommendation.types.js';
import type {
  ClientHomeLayout,
  ClientHomeSection,
  ClientMediaCard,
  ClientMediaType,
} from './client-home.types.js';

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
    private readonly profileAccessService = new ProfileAccessService(),
    private readonly metadataCardService = new MetadataCardService(),
    private readonly tasteProfileRepository = new TasteProfileRepository(),
    private readonly snapshotsRepository = new RecommendationSnapshotsRepository(),
    private readonly contentIdentityService = new ContentIdentityService(),
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
  async upsertHomeForAccount(
    accountId: string,
    profileId: string,
    input: RecommendationSnapshotInput,
  ): Promise<RecommendationHomePayload> {
    const snapshot = await this.upsertRecommendationsForAccount(accountId, profileId, input);
    return toHomePayload(profileId, snapshot);
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
  async getHomeForAccount(
    accountId: string,
    profileId: string,
    sourceKey: string,
    algorithmVersion: string,
  ): Promise<RecommendationHomePayload> {
    const snapshot = await this.getRecommendationsForAccount(accountId, profileId, sourceKey, algorithmVersion);
    return toHomePayload(profileId, snapshot);
  }


  async upsertRecommendationsForAccount(
    accountId: string,
    profileId: string,
    input: RecommendationSnapshotInput,
  ): Promise<RecommendationSnapshotPayload> {
    return withDbClient(async (client) => {
      await this.requireOwnedProfile(client, accountId, profileId);
      const sections = sanitizeRecommendationSections(input.sections);
      const row = await this.snapshotsRepository.upsert(client, {
        profileId,
        sourceKey: input.sourceKey,
        historyGeneration: input.historyGeneration,
        algorithmVersion: input.algorithmVersion,
        sourceCursor: input.sourceCursor,
        generatedAt: input.generatedAt,
        expiresAt: input.expiresAt,
        items: sections,
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
      const sections = sanitizeRecommendationSections(input.sections);
      const row = await this.snapshotsRepository.upsert(client, {
        profileId: targetProfileId,
        sourceKey: input.sourceKey,
        historyGeneration: input.historyGeneration,
        algorithmVersion: input.algorithmVersion,
        sourceCursor: input.sourceCursor,
        generatedAt: input.generatedAt,
        expiresAt: input.expiresAt,
        items: sections,
        source: input.source,
        updatedByKind: 'service',
        updatedById: input.updatedById ?? null,
      });
      return this.mapRecommendationSnapshot(client, row);
    });
  }

  async getActiveRecommendationForAccount(
    accountId: string,
    profileId: string,
    algorithmVersion: string,
  ): Promise<RecommendationSnapshotPayload | null> {
    return withDbClient(async (client) => {
      await this.requireOwnedProfile(client, accountId, profileId);
      const row = await this.snapshotsRepository.findByProfileSourceAndAlgorithm(
        client,
        profileId,
        recommendationConfig.sourceKey,
        algorithmVersion,
      );
      return row ? this.mapRecommendationSnapshot(client, row) : null;
    });
  }

  async clearOutputsForProfile(client: DbClient, profileId: string): Promise<void> {
    await this.tasteProfileRepository.deleteForProfile(client, profileId);
    await this.snapshotsRepository.clearForProfile(client, profileId);
  }

  private async requireOwnedProfile(client: DbClient, accountId: string, profileId: string): Promise<void> {
    await this.profileAccessService.assertOwnedProfile(client, profileId, accountId);
  }

  private async requireOwnedProfileForAccount(client: DbClient, accountId: string, profileId: string): Promise<string> {
    const profile = await this.profileAccessService.assertOwnedProfile(client, profileId, accountId);
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
    const layout = readClientHomeLayout(row.layout);
    const rawItems = Array.isArray(row.items) ? row.items : [];
    const id = typeof row.id === 'string' ? row.id : 'recommended';
    const title = typeof row.title === 'string' ? row.title : 'Recommended';
    const meta = asRecord(row.meta);

    if (layout === 'hero' || layout === 'landscape' || layout === 'collection') {
      return {
        listKey: id,
        title,
        subtitle: readNullableText(row.subtitle),
        layout,
        items: (await Promise.all(rawItems.map((item) => this.mapClientMediaCard(client, item))))
          .filter((item): item is ClientMediaCard => item !== null),
        meta,
      };
    }

    return {
      listKey: id,
      title,
      subtitle: readNullableText(row.subtitle),
      layout: 'regular',
      items: (await Promise.all(rawItems.map((item) => this.mapClientMediaCard(client, item))))
        .filter((item): item is ClientMediaCard => item !== null),
      meta,
    };
  }

  private async mapClientMediaCard(client: DbClient, value: unknown): Promise<ClientMediaCard | null> {
    const row = asRecord(value);
    const itemId = readPublicItemId(row.itemId);
    if (!itemId) { return null; }
    const identity = await this.contentIdentityService.resolveMediaIdentity(client, assertPublicItemId(itemId));
    const card = await this.metadataCardService.buildCardView(client, identity);
    return card ? toClientMediaCard(card, row) : null;
  }
}

function toHomePayload(profileId: string, snapshot: RecommendationSnapshotPayload | null): RecommendationHomePayload {
  return {
    profileId,
    generatedAt: snapshot?.generatedAt ?? new Date(0).toISOString(),
    expiresAt: snapshot?.expiresAt ?? null,
    sections: snapshot?.sections ?? [],
  };
}

function toClientMediaCard(card: MetadataCardView, row: Record<string, unknown>): ClientMediaCard | null {
  if (!card.title) {
    return null;
  }
  return {
    itemId: card.itemId,
    mediaType: toClientMediaType(card.mediaType),
    title: card.title,
    subtitle: readNullableText(row.subtitle) ?? card.subtitle,
    overview: readNullableText(row.description) ?? card.overview ?? card.summary,
    year: card.releaseYear,
    releaseDate: card.releaseDate,
    rating: card.rating,
    maturityRating: card.maturityRating,
    genres: card.genres,
    runtimeSeconds: typeof card.runtimeMinutes === 'number' ? card.runtimeMinutes * 60 : null,
    images: {
      poster: card.images.poster,
      backdrop: card.images.backdrop,
      logo: card.images.logo,
      still: card.images.still,
    },
    progress: null,
    parent: card.seriesItemId || card.seasonItemId || card.seasonNumber !== null || card.episodeNumber !== null
      ? {
          seriesItemId: card.seriesItemId ?? undefined,
          seasonItemId: card.seasonItemId ?? undefined,
          seasonNumber: card.seasonNumber,
          episodeNumber: card.episodeNumber,
        }
      : null,
  };
}

function toClientMediaType(mediaType: MetadataCardView['mediaType']): ClientMediaType {
  if (mediaType === 'show') return 'tv';
  return mediaType;
}

function readNullableText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function sanitizeRecommendationSections(value: unknown[]): unknown[] {
  return value.map((section) => sanitizeRecommendationSection(section)).filter((section): section is Record<string, unknown> => section !== null);
}

function sanitizeRecommendationSection(value: unknown): Record<string, unknown> | null {
  const row = asRecord(value);
  const layout = readClientHomeLayout(row.layout);
  const items = Array.isArray(row.items) ? row.items : [];
  const sanitizedItems = items.map((item) => sanitizeRecommendationMediaItem(item)).filter((item): item is Record<string, unknown> => item !== null);

  return {
    id: typeof row.id === 'string' && row.id.trim() ? row.id.trim() : typeof row.listKey === 'string' && row.listKey.trim() ? row.listKey.trim() : 'recommended',
    title: typeof row.title === 'string' && row.title.trim() ? row.title.trim() : 'Recommended',
    subtitle: readNullableText(row.subtitle),
    layout,
    meta: asRecord(row.meta),
    items: sanitizedItems,
  };
}

function sanitizeRecommendationMediaItem(value: unknown): Record<string, unknown> | null {
  const row = asRecord(value);
  const itemId = readPublicItemId(row.itemId);
  if (!itemId) {
    return null;
  }

  return {
    itemId,
    mediaType: typeof row.mediaType === 'string' ? row.mediaType : null,
    reason: typeof row.reason === 'string' ? row.reason : null,
    score: typeof row.score === 'number' ? row.score : null,
    rank: typeof row.rank === 'number' ? row.rank : null,
    payload: asRecord(row.payload),
  };
}

function readClientHomeLayout(value: unknown): ClientHomeLayout {
  return value === 'landscape' || value === 'collection' || value === 'hero' ? value : 'regular';
}

function readPublicItemId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const itemId = value.trim();
  if (!itemId) {
    return null;
  }
  try {
    assertPublicItemId(itemId);
    return itemId;
  } catch {
    return null;
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
