import { withDbClient, type DbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { MetadataViewService } from '../metadata/metadata-view.service.js';
import { ProfileAccessService } from '../profiles/profile-access.service.js';
import { ProfileSettingsRepository } from '../profiles/profile-settings.repo.js';
import { inferMediaIdentity, parseMediaKey } from '../identity/media-key.js';
import type {
  CollectionCardItemView,
  CollectionCardView,
  HeroCardView,
  LandscapeCardView,
  MetadataCardView,
  RegularCardView,
} from '../metadata/metadata.types.js';
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
    private readonly profileAccessService = new ProfileAccessService(),
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
        .filter((item): item is NonNullable<Awaited<ReturnType<RecommendationOutputService['mapLandscapeRecommendationItem']>>> => item !== null);
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

    return {
      media: toRegularCard(await this.metadataViewService.buildMetadataCardView(client, identity)),
      reason: typeof row.reason === 'string' ? row.reason : null,
      score: typeof row.score === 'number' ? row.score : null,
      rank: typeof row.rank === 'number' ? row.rank : index + 1,
      payload: asRecord(row.payload),
    };
  }

  private async mapLandscapeRecommendationItem(client: DbClient, value: unknown, index: number) {
    const row = asRecord(value);
    const identity = recommendationIdentityFromRow(row);
    const media = toLandscapeCard(await this.metadataViewService.buildMetadataCardView(client, identity));
    if (!media) {
      return null;
    }

    return {
      media,
      reason: typeof row.reason === 'string' ? row.reason : null,
      score: typeof row.score === 'number' ? row.score : null,
      rank: typeof row.rank === 'number' ? row.rank : index + 1,
      payload: asRecord(row.payload),
    };
  }

  private mapCollectionCard(value: unknown): CollectionCardView | null {
    const row = asRecord(value);
    const title = typeof row.title === 'string' && row.title.trim() ? row.title : null;
    const logoUrl = typeof row.logoUrl === 'string' && row.logoUrl.trim() ? row.logoUrl : typeof row.logo_url === 'string' && row.logo_url.trim() ? row.logo_url : null;
    const rawItems = Array.isArray(row.items) ? row.items : [];
    const items = rawItems.map((item) => this.mapCollectionCardItem(item)).filter((item): item is CollectionCardItemView => item !== null);
    if (!title || !logoUrl || items.length < 3) {
      return null;
    }

    return {
      title,
      logoUrl,
      items: [items[0]!, items[1]!, items[2]!],
    };
  }

  private mapCollectionCardItem(value: unknown): CollectionCardItemView | null {
    const row = asRecord(value);
    const mediaType = typeof row.mediaType === 'string' ? row.mediaType : typeof row.media_type === 'string' ? row.media_type : null;
    const provider = typeof row.provider === 'string' ? row.provider : null;
    const providerId = typeof row.providerId === 'string' ? row.providerId : typeof row.provider_id === 'string' ? row.provider_id : null;
    const title = typeof row.title === 'string' ? row.title : null;
    const posterUrl = typeof row.posterUrl === 'string' ? row.posterUrl : typeof row.poster_url === 'string' ? row.poster_url : null;
    if (!mediaType || !provider || !providerId || !title || !posterUrl) {
      return null;
    }

    return {
      mediaType: mediaType as CollectionCardItemView['mediaType'],
      provider: provider as CollectionCardItemView['provider'],
      providerId,
      title,
      posterUrl,
      releaseYear: typeof row.releaseYear === 'number' ? row.releaseYear : typeof row.release_year === 'number' ? row.release_year : null,
      rating: typeof row.rating === 'number' ? row.rating : null,
    };
  }

  private async mapHeroCard(client: DbClient, value: unknown): Promise<HeroCardView | null> {
    const row = asRecord(value);
    const identity = recommendationIdentityFromRow(row);
    const media = await this.metadataViewService.buildMetadataCardView(client, identity);
    return toHeroCard(media, row);
  }
}

function toRegularCard(card: MetadataCardView): RegularCardView {
  return {
    mediaType: card.mediaType,
    mediaKey: card.mediaKey,
    provider: card.provider,
    providerId: card.providerId,
    title: card.title ?? 'Untitled',
    posterUrl: card.images.posterUrl ?? card.artwork.posterUrl ?? '',
    releaseYear: card.releaseYear,
    rating: card.rating,
    genre: null,
    subtitle: card.subtitle,
  };
}

function toLandscapeCard(card: MetadataCardView): LandscapeCardView | null {
  const posterUrl = card.images.posterUrl ?? card.artwork.posterUrl;
  const backdropUrl = card.images.stillUrl ?? card.artwork.stillUrl ?? card.images.backdropUrl ?? card.artwork.backdropUrl ?? posterUrl;
  if (!card.title || !posterUrl || !backdropUrl) {
    return null;
  }

  return {
    mediaType: card.mediaType,
    mediaKey: card.mediaKey,
    provider: card.provider,
    providerId: card.providerId,
    title: card.title,
    posterUrl,
    backdropUrl,
    releaseYear: card.releaseYear,
    rating: card.rating,
    genre: null,
    seasonNumber: card.seasonNumber,
    episodeNumber: card.episodeNumber,
    episodeTitle: card.mediaType === 'episode' ? card.title : null,
    airDate: card.releaseDate,
    runtimeMinutes: card.runtimeMinutes,
  };
}

function toHeroCard(card: MetadataCardView, row: Record<string, unknown>): HeroCardView | null {
  const backdropUrl = card.images.backdropUrl ?? card.artwork.backdropUrl;
  const description = typeof row.description === 'string' && row.description.trim()
    ? row.description
    : card.overview ?? card.summary ?? null;
  if (!card.title || !backdropUrl || !description) {
    return null;
  }

  return {
    mediaType: card.mediaType,
    provider: card.provider,
    providerId: card.providerId,
    title: card.title,
    description,
    backdropUrl,
    posterUrl: card.images.posterUrl ?? card.artwork.posterUrl,
    logoUrl: card.images.logoUrl ?? null,
    releaseYear: card.releaseYear,
    rating: card.rating,
    genre: null,
  };
}

function recommendationIdentityFromRow(row: Record<string, unknown>) {
  const mediaKey = typeof row.mediaKey === 'string' ? row.mediaKey : typeof row.media_key === 'string' ? row.media_key : null;
  const mediaType = typeof row.mediaType === 'string' ? row.mediaType : typeof row.media_type === 'string' ? row.media_type : 'movie';
  return mediaKey
    ? parseMediaKey(mediaKey)
    : inferMediaIdentity({
        mediaType,
        tmdbId: typeof row.tmdbId === 'number' ? row.tmdbId : typeof row.tmdb_id === 'number' ? row.tmdb_id : null,
        showTmdbId: typeof row.showTmdbId === 'number' ? row.showTmdbId : typeof row.show_tmdb_id === 'number' ? row.show_tmdb_id : null,
        seasonNumber: typeof row.seasonNumber === 'number' ? row.seasonNumber : typeof row.season_number === 'number' ? row.season_number : null,
        episodeNumber: typeof row.episodeNumber === 'number' ? row.episodeNumber : typeof row.episode_number === 'number' ? row.episode_number : null,
      });
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
