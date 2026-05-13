import { withDbClient, type DbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { MetadataCardService } from '../metadata/metadata-card.service.js';
import { buildResponsiveImageSet } from '../metadata/metadata-builder.shared.js';
import { metadataCardToMediaItem } from '../metadata/media-item.mapper.js';
import { ProfileAccessService } from '../profiles/profile-access.service.js';
import { inferMediaIdentity, parseMediaKey } from '../identity/media-key.js';
import type {
  CollectionCardItemView,
  CollectionCardView,
  HeroCardView,
  MetadataCardView,
} from '../metadata/metadata-card.types.js';
import { TasteProfileRepository, type TasteProfileRecord } from './taste-profile.repo.js';
import {
  RecommendationSnapshotsRepository,
  type RecommendationSnapshotRecord,
} from './recommendation-snapshots.repo.js';
import { recommendationConfig } from './recommendation-config.js';
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
    private readonly profileAccessService = new ProfileAccessService(),
    private readonly metadataCardService = new MetadataCardService(),
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
    const layout = row.layout === 'landscape' || row.layout === 'collection' || row.layout === 'hero'
      ? row.layout
      : 'regular';
    const rawItems = Array.isArray(row.items) ? row.items : [];
    const id = typeof row.id === 'string' ? row.id : 'recommended';
    const title = typeof row.title === 'string' ? row.title : 'Recommended';
    const meta = asRecord(row.meta);

    if (layout === 'collection') {
      return {
        id,
        title,
        layout,
        items: rawItems.map((item) => this.mapCollectionCard(item)).filter((item): item is CollectionCardView => item !== null),
        meta,
      };
    }

    if (layout === 'hero') {
      return {
        id,
        title,
        layout,
        items: (await Promise.all(rawItems.map((item) => this.mapHeroCard(client, item)))).filter((item): item is HeroCardView => item !== null),
        meta,
      };
    }

    if (layout === 'landscape') {
      const items = (await Promise.all(rawItems.map((item, index) => this.mapLandscapeRecommendationItem(client, item, index))))
        .filter((item): item is RecommendationSectionItem => item !== null);
      return {
        id,
        title,
        layout,
        items,
        meta,
      };
    }

    return {
      id,
      title,
      layout: 'regular',
      items: await Promise.all(rawItems.map((item, index) => this.mapRecommendationItem(client, item, index))),
      meta,
    };
  }

  private async mapRecommendationItem(client: DbClient, value: unknown, index: number): Promise<RecommendationSectionItem> {
    const row = asRecord(value);
    const identity = recommendationIdentityFromRow(row);
    const card = await this.metadataCardService.buildCardView(client, identity);
    const mediaItem = metadataCardToMediaItem(card);

    return {
      kind: 'recommendation',
      mediaItem,
      context: {
        reason: typeof row.reason === 'string' ? row.reason : null,
        reasonCodes: [],
        score: typeof row.score === 'number' ? row.score : null,
        rank: typeof row.rank === 'number' ? row.rank : index + 1,
        payload: asRecord(row.payload),
      },
      presentation: { preferredSize: 'poster', sectionId: null, sectionTitle: null },
      reason: typeof row.reason === 'string' ? row.reason : null,
      score: typeof row.score === 'number' ? row.score : null,
      rank: typeof row.rank === 'number' ? row.rank : index + 1,
      payload: asRecord(row.payload),
    };
  }

  private async mapLandscapeRecommendationItem(client: DbClient, value: unknown, index: number): Promise<RecommendationSectionItem | null> {
    const row = asRecord(value);
    const identity = recommendationIdentityFromRow(row);
    const card = await this.metadataCardService.buildCardView(client, identity);
    const mediaItem = metadataCardToMediaItem(card);

    return {
      kind: 'recommendation',
      mediaItem,
      context: {
        reason: typeof row.reason === 'string' ? row.reason : null,
        reasonCodes: [],
        score: typeof row.score === 'number' ? row.score : null,
        rank: typeof row.rank === 'number' ? row.rank : index + 1,
        payload: asRecord(row.payload),
      },
      presentation: { preferredSize: 'wide', sectionId: null, sectionTitle: null },
      reason: typeof row.reason === 'string' ? row.reason : null,
      score: typeof row.score === 'number' ? row.score : null,
      rank: typeof row.rank === 'number' ? row.rank : index + 1,
      payload: asRecord(row.payload),
    };
  }

  private mapCollectionCard(value: unknown): CollectionCardView | null {
    const row = asRecord(value);
    const title = typeof row.title === 'string' && row.title.trim() ? row.title : null;
    const logoUrl = typeof row.logoUrl === 'string' && row.logoUrl.trim() ? row.logoUrl : null;
    const rawItems = Array.isArray(row.items) ? row.items : [];
    const items = rawItems.map((item) => this.mapCollectionCardItem(item)).filter((item): item is CollectionCardItemView => item !== null);
    if (!title || !logoUrl || items.length < 3) {
      return null;
    }

    return {
      title,
      logo: buildResponsiveImageSet(logoUrl, {
        small: 'w185',
        medium: 'w300',
        large: 'w500',
      }),
      items: [items[0]!, items[1]!, items[2]!],
    };
  }

  private mapCollectionCardItem(value: unknown): CollectionCardItemView | null {
    const row = asRecord(value);
    const mediaType = typeof row.mediaType === 'string' ? row.mediaType : null;
    const title = typeof row.title === 'string' ? row.title : null;
    const posterUrl = typeof row.posterUrl === 'string' ? row.posterUrl : null;
    if (!mediaType || !title || !posterUrl) {
      return null;
    }

    return {
      mediaType: mediaType as CollectionCardItemView['mediaType'],
      title,
      poster: buildResponsiveImageSet(posterUrl, {
        small: 'w342',
        medium: 'w500',
        large: 'w780',
      }),
      releaseYear: typeof row.releaseYear === 'number' ? row.releaseYear : null,
      rating: typeof row.rating === 'number' ? row.rating : null,
    };
  }

  private async mapHeroCard(client: DbClient, value: unknown): Promise<HeroCardView | null> {
    const row = asRecord(value);
    const identity = recommendationIdentityFromRow(row);
    const media = await this.metadataCardService.buildCardView(client, identity);
    return toHeroCard(media, row);
  }
}

function toHeroCard(card: MetadataCardView, row: Record<string, unknown>): HeroCardView | null {
  const backdrop = card.images.backdrop;
  const description = typeof row.description === 'string' && row.description.trim()
    ? row.description
    : card.overview ?? card.summary ?? null;
  if (!card.title || (!backdrop.small && !backdrop.medium && !backdrop.large) || !description) {
    return null;
  }

  return {
    mediaKey: card.mediaKey,
    mediaType: card.mediaType,
    title: card.title,
    description,
    backdrop,
    poster: card.images.poster,
    logo: card.images.logo,
    releaseYear: card.releaseYear,
    rating: card.rating,
    genre: null,
  };
}

function recommendationIdentityFromRow(row: Record<string, unknown>) {
  const mediaKey = typeof row.mediaKey === 'string' ? row.mediaKey : null;
  const mediaType = typeof row.mediaType === 'string' ? row.mediaType : 'movie';
  return mediaKey
      ? parseMediaKey(mediaKey)
      : inferMediaIdentity({
          mediaType,
          tmdbId: typeof row.tmdbId === 'number' ? row.tmdbId : null,
          tvdbId: null,
          kitsuId: null,
          showTmdbId: typeof row.showTmdbId === 'number' ? row.showTmdbId : null,
        seasonNumber: typeof row.seasonNumber === 'number' ? row.seasonNumber : null,
        episodeNumber: typeof row.episodeNumber === 'number' ? row.episodeNumber : null,
        absoluteEpisodeNumber: typeof row.absoluteEpisodeNumber === 'number' ? row.absoluteEpisodeNumber : null,
      });
}

function sanitizeRecommendationSections(value: unknown[]): unknown[] {
  return value.map((section) => sanitizeRecommendationSection(section)).filter((section): section is Record<string, unknown> => section !== null);
}

function sanitizeRecommendationSection(value: unknown): Record<string, unknown> | null {
  const row = asRecord(value);
  const layout = row.layout === 'landscape' || row.layout === 'collection' || row.layout === 'hero'
    ? row.layout
    : 'regular';
  const items = Array.isArray(row.items) ? row.items : [];
  const sanitizedItems = layout === 'collection'
    ? items.map((item) => sanitizeCollectionCard(item)).filter((item): item is Record<string, unknown> => item !== null)
    : items.map((item) => sanitizeRecommendationMediaItem(item)).filter((item): item is Record<string, unknown> => item !== null);

  return {
    ...row,
    id: typeof row.id === 'string' && row.id.trim() ? row.id.trim() : 'recommended',
    title: typeof row.title === 'string' && row.title.trim() ? row.title.trim() : 'Recommended',
    layout,
    meta: asRecord(row.meta),
    items: sanitizedItems,
  };
}

function sanitizeRecommendationMediaItem(value: unknown): Record<string, unknown> | null {
  const row = asRecord(value);
  const mediaKey = readOptionalIdentityString(row.mediaKey);
  if (!mediaKey) {
    return null;
  }

  const parsed = parseMediaKey(mediaKey);
  const payload = asRecord(row.payload);
  const result: Record<string, unknown> = {
    ...row,
    mediaKey,
    mediaType: parsed.mediaType,
    tmdbId: parsed.tmdbId,
    tvdbId: null,
    kitsuId: null,
    showTmdbId: parsed.showTmdbId,
    seasonNumber: parsed.seasonNumber,
    episodeNumber: parsed.episodeNumber,
    absoluteEpisodeNumber: parsed.absoluteEpisodeNumber ?? null,
    reason: typeof row.reason === 'string' ? row.reason : null,
    score: typeof row.score === 'number' ? row.score : null,
    rank: typeof row.rank === 'number' ? row.rank : null,
    payload,
  };

  return result;
}

function sanitizeCollectionCard(value: unknown): Record<string, unknown> | null {
  const row = asRecord(value);
  const title = typeof row.title === 'string' && row.title.trim() ? row.title.trim() : null;
  const logoUrl = typeof row.logoUrl === 'string' && row.logoUrl.trim() ? row.logoUrl.trim() : null;
  const items = Array.isArray(row.items) ? row.items : [];
  const sanitizedItems = items.map((item) => sanitizeCollectionCardItem(item)).filter((item): item is Record<string, unknown> => item !== null);
  if (!title || !logoUrl || sanitizedItems.length < 3) {
    return null;
  }

  return {
    ...row,
    title,
    logoUrl,
    items: sanitizedItems,
  };
}

function sanitizeCollectionCardItem(value: unknown): Record<string, unknown> | null {
  const row = asRecord(value);
  const mediaType = typeof row.mediaType === 'string' ? row.mediaType : null;
  const title = typeof row.title === 'string' && row.title.trim() ? row.title.trim() : null;
  const posterUrl = typeof row.posterUrl === 'string' && row.posterUrl.trim() ? row.posterUrl.trim() : null;
  if (!mediaType || !title || !posterUrl) {
    return null;
  }

  return {
    ...row,
    mediaType,
    title,
    posterUrl,
    releaseYear: typeof row.releaseYear === 'number' ? row.releaseYear : null,
    rating: typeof row.rating === 'number' ? row.rating : null,
  };
}

function readOptionalIdentityString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
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
