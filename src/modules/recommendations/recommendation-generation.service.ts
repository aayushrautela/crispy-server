import { withDbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { logger } from '../../config/logger.js';
import { FeatureEntitlementService } from '../entitlements/feature-entitlement.service.js';
import { ProfileRepository } from '../profiles/profile.repo.js';
import { RecommendationDataService } from './recommendation-data.service.js';
import { recommendationConfig } from './recommendation-config.js';
import { RecommendationOutputService } from './recommendation-output.service.js';
import { RecommendationSnapshotsRepository } from './recommendation-snapshots.repo.js';
import { ProfileWatchDataStateRepository } from '../integrations/profile-watch-data-state.repo.js';
import { PersonalMediaService } from '../watch/personal-media.service.js';
import type {
  RecommendationSignalBundle,
  RecommendationSignalContinueWatchingItem,
  RecommendationSignalGenerationResponse,
} from './recommendation-signal.types.js';
import type { ContinueWatchingProductItem } from '../watch/watch-derived-item.types.js';

type GenerationContext = {
  accountId: string;
  profileId: string;
  profileName: string;
  isKids: boolean;
  historyGeneration: number;
  currentOrigin: string;
  sourceCursor: string | null;
};

export type RecommendationGenerationBuildResult = {
  context: GenerationContext;
  payload: RecommendationSignalBundle;
};

export type RecommendationGenerationApplyResult = {
  profileId: string;
  sourceKey: string;
  algorithmVersion: string;
  historyGeneration: number;
  sections: number;
};

type GenerationExpectationContext = Pick<GenerationContext, 'accountId' | 'profileId' | 'historyGeneration' | 'sourceCursor'>;

export class RecommendationGenerationService {
  constructor(
    private readonly profileRepository = new ProfileRepository(),
    private readonly watchDataStateRepository = new ProfileWatchDataStateRepository(),
    private readonly snapshotsRepository = new RecommendationSnapshotsRepository(),
    private readonly recommendationDataService = new RecommendationDataService(),
    private readonly personalMediaService = new PersonalMediaService(),
    private readonly featureEntitlementService = new FeatureEntitlementService(),
    private readonly recommendationOutputService = new RecommendationOutputService(),
  ) {}

  async buildGenerationRequest(profileId: string): Promise<RecommendationGenerationBuildResult> {
    const context = await this.loadGenerationContext(profileId);
    const aiRequest = await this.featureEntitlementService.resolveAiRequestForTask(context.accountId, 'recommendations');
    const payload = await this.buildRequest(context, aiRequest);
    return { context, payload };
  }

  async loadRequestContext(profileId: string): Promise<RecommendationGenerationBuildResult['context']> {
    return this.loadGenerationContext(profileId);
  }

  async applyGenerationResponse(
    context: GenerationExpectationContext,
    response: RecommendationSignalGenerationResponse,
  ): Promise<RecommendationGenerationApplyResult> {
    const normalizedTasteProfile = normalizeTasteProfile(response, context);
    const normalizedSnapshot = normalizeRecommendationSnapshot(response, context);

    await Promise.all([
      this.recommendationOutputService.upsertTasteProfileForAccountService(context.accountId, context.profileId, normalizedTasteProfile),
      this.recommendationOutputService.upsertRecommendationsForAccountService(context.accountId, context.profileId, normalizedSnapshot),
    ]);

    logger.info({
      profileId: context.profileId,
      sourceKey: normalizedSnapshot.sourceKey,
      algorithmVersion: normalizedSnapshot.algorithmVersion,
      historyGeneration: normalizedSnapshot.historyGeneration,
      sections: normalizedSnapshot.sections.length,
    }, 'recommendation generation completed');

    return {
      profileId: context.profileId,
      sourceKey: normalizedSnapshot.sourceKey,
      algorithmVersion: normalizedSnapshot.algorithmVersion,
      historyGeneration: normalizedSnapshot.historyGeneration,
      sections: normalizedSnapshot.sections.length,
    };
  }

  private async loadGenerationContext(profileId: string): Promise<GenerationContext> {
    return withDbClient(async (client) => {
      const profile = await this.profileRepository.findById(client, profileId);
      if (!profile) {
        throw new HttpError(404, 'Profile not found.');
      }

      const [accountId, watchDataState, snapshot] = await Promise.all([
        this.profileRepository.findOwnerUserIdById(client, profileId),
        this.watchDataStateRepository.ensure(client, profileId),
        this.snapshotsRepository.findByProfileSourceAndAlgorithm(
          client,
          profileId,
          recommendationConfig.sourceKey,
          recommendationConfig.algorithmVersion,
        ),
      ]);

      if (!accountId) {
        throw new HttpError(404, 'Profile owner not found.');
      }

      return {
        accountId,
        profileId,
        profileName: profile.name,
        isKids: profile.isKids,
        historyGeneration: watchDataState.historyGeneration,
        currentOrigin: watchDataState.currentOrigin,
        sourceCursor: snapshot?.sourceCursor ?? null,
      };
    });
  }

  private async buildRequest(
    context: GenerationContext,
    aiRequest: Awaited<ReturnType<FeatureEntitlementService['resolveAiRequestForUser']>>,
  ): Promise<RecommendationSignalBundle> {
    const limits = recommendationConfig.payloadLimits;
    const [watchHistory, ratings, watchlist, continueWatching, trackedSeries] = await Promise.all([
      this.recommendationDataService.getWatchHistoryForAccount(context.accountId, context.profileId, limits.watchHistory),
      this.recommendationDataService.getRatingsForAccount(context.accountId, context.profileId, limits.ratings),
      this.recommendationDataService.getWatchlistForAccount(context.accountId, context.profileId, limits.watchlist),
      this.personalMediaService.listContinueWatchingProducts(context.accountId, context.profileId, limits.continueWatching),
      this.recommendationDataService.getEpisodicFollowForAccount(context.accountId, context.profileId, limits.trackedSeries),
    ]);

    return {
      identity: {
        accountId: context.accountId,
        profileId: context.profileId,
      },
      generationMeta: {
        sourceKey: recommendationConfig.sourceKey,
        algorithmVersion: recommendationConfig.algorithmVersion as RecommendationSignalBundle['generationMeta']['algorithmVersion'],
        historyGeneration: context.historyGeneration,
        sourceCursor: context.sourceCursor,
        ttlSeconds: recommendationConfig.generationTtlSeconds,
      },
      watchHistory,
      ratings,
      watchlist,
      profileContext: {
        profileName: context.profileName,
        isKids: context.isKids,
        watchDataOrigin: context.currentOrigin,
      },
      aiConfig: {
        providerId: aiRequest.providerId,
        endpointUrl: aiRequest.provider.endpointUrl,
        httpReferer: aiRequest.provider.httpReferer,
        title: aiRequest.provider.title,
        model: aiRequest.model,
        apiKey: aiRequest.apiKey,
        credentialSource: aiRequest.credentialSource,
      },
      optionalExtras: {
        continueWatching: continueWatching.map(mapContinueWatchingItem),
        trackedSeries,
        limits,
      },
    };
  }
}

export function mapContinueWatchingItem(item: ContinueWatchingProductItem): RecommendationSignalContinueWatchingItem {
  return {
    id: item.id,
    media: {
      mediaType: item.media.mediaType,
      mediaKey: item.media.mediaKey,
      provider: item.media.provider,
      providerId: item.media.providerId,
      title: item.media.title,
    },
    progress: {
      positionSeconds: item.progress.positionSeconds,
      durationSeconds: item.progress.durationSeconds,
      progressPercent: item.progress.progressPercent,
      ...(item.progress.lastPlayedAt ? { lastPlayedAt: item.progress.lastPlayedAt } : {}),
    },
    lastActivityAt: item.lastActivityAt,
    payload: {},
  };
}

function normalizeTasteProfile(response: RecommendationSignalGenerationResponse, context: GenerationExpectationContext) {
  const tasteProfile = asRecord(response.tasteProfile);
  const sourceKey = readRequiredString(tasteProfile.sourceKey, 'Recommendation generation returned a taste profile without a source key.');
  if (sourceKey !== recommendationConfig.sourceKey) {
    throw new HttpError(502, 'Recommendation generation returned an unexpected taste profile source key.');
  }

  return {
    sourceKey,
    genres: Array.isArray(tasteProfile.genres) ? tasteProfile.genres : [],
    preferredActors: Array.isArray(tasteProfile.preferredActors) ? tasteProfile.preferredActors : [],
    preferredDirectors: Array.isArray(tasteProfile.preferredDirectors) ? tasteProfile.preferredDirectors : [],
    contentTypePref: asRecord(tasteProfile.contentTypePref),
    ratingTendency: asRecord(tasteProfile.ratingTendency),
    decadePreferences: Array.isArray(tasteProfile.decadePreferences) ? tasteProfile.decadePreferences : [],
    watchingPace: readOptionalString(tasteProfile.watchingPace),
    aiSummary: readOptionalString(tasteProfile.aiSummary),
    source: readOptionalString(tasteProfile.source) ?? 'ai_generation',
    updatedById: context.accountId,
  };
}

function normalizeRecommendationSnapshot(response: RecommendationSignalGenerationResponse, context: GenerationExpectationContext) {
  const snapshot = asRecord(response.recommendationSnapshot);
  const sourceKey = readRequiredString(snapshot.sourceKey, 'Recommendation generation returned a snapshot without a source key.');
  const algorithmVersion = readRequiredString(snapshot.algorithmVersion, 'Recommendation generation returned a snapshot without an algorithm version.');
  const historyGeneration = readRequiredNumber(snapshot.historyGeneration, 'Recommendation generation returned a snapshot without a history generation.');

  if (sourceKey !== recommendationConfig.sourceKey) {
    throw new HttpError(502, 'Recommendation generation returned an unexpected snapshot source key.');
  }
  if (algorithmVersion !== recommendationConfig.algorithmVersion) {
    throw new HttpError(502, 'Recommendation generation returned an unexpected algorithm version.');
  }
  if (historyGeneration !== context.historyGeneration) {
    throw new HttpError(502, 'Recommendation generation returned an unexpected history generation.');
  }

  const generatedAt = readOptionalString(snapshot.generatedAt)
    ?? readOptionalString(asRecord(response.generation).completedAt)
    ?? new Date().toISOString();
  const expiresAt = readOptionalString(snapshot.expiresAt) ?? buildExpiresAt(generatedAt, recommendationConfig.generationTtlSeconds);
  const sections = Array.isArray(snapshot.sections) ? snapshot.sections : [];
  const normalizedSections = sections.map((section) => normalizeSection(section)).filter((section): section is Record<string, unknown> => section !== null);

  return {
    sourceKey,
    historyGeneration,
    algorithmVersion,
    sourceCursor: readOptionalString(snapshot.sourceCursor),
    generatedAt,
    expiresAt,
    source: readOptionalString(snapshot.source) ?? 'ai_generation',
    updatedById: context.accountId,
    sections: normalizedSections,
  };
}

function buildExpiresAt(generatedAt: string, ttlSeconds: number): string {
  const generatedTime = Date.parse(generatedAt);
  if (!Number.isFinite(generatedTime)) {
    return new Date(Date.now() + ttlSeconds * 1000).toISOString();
  }
  return new Date(generatedTime + ttlSeconds * 1000).toISOString();
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readRequiredString(value: unknown, message: string): string {
  const parsed = readOptionalString(value);
  if (!parsed) {
    throw new HttpError(502, message);
  }
  return parsed;
}

function readOptionalNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readRequiredNumber(value: unknown, message: string): number {
  const parsed = readOptionalNumber(value);
  if (parsed === null) {
    throw new HttpError(502, message);
  }
  return parsed;
}

function normalizeSection(value: unknown): Record<string, unknown> | null {
  const row = asRecord(value);
  const layout = row.layout === 'landscape' || row.layout === 'collection' || row.layout === 'hero'
    ? row.layout
    : 'regular';
  const items = Array.isArray(row.items) ? row.items : [];
  const normalizedItems = layout === 'collection'
    ? items.map((item) => normalizeCollectionCard(item)).filter((item): item is Record<string, unknown> => item !== null)
    : items.map((item) => normalizeMediaItem(item)).filter((item): item is Record<string, unknown> => item !== null);

  return {
    ...row,
    id: readOptionalString(row.id) ?? 'recommended',
    title: readOptionalString(row.title) ?? 'Recommended',
    layout,
    meta: asRecord(row.meta),
    items: normalizedItems,
  };
}

function normalizeMediaItem(value: unknown): Record<string, unknown> | null {
  const row = asRecord(value);
  const mediaKey = readOptionalString(row.mediaKey) ?? readOptionalString(row.media_key);
  if (!mediaKey) {
    return null;
  }

  return {
    ...row,
    mediaKey,
    reason: readOptionalString(row.reason),
    score: readOptionalNumber(row.score),
    rank: readOptionalNumber(row.rank),
    payload: asRecord(row.payload),
  };
}

function normalizeCollectionCard(value: unknown): Record<string, unknown> | null {
  const row = asRecord(value);
  const title = readOptionalString(row.title);
  const logoUrl = readOptionalString(row.logoUrl) ?? readOptionalString(row.logo_url);
  const items = Array.isArray(row.items) ? row.items : [];
  const normalizedItems = items.map((item) => normalizeCollectionCardItem(item)).filter((item): item is Record<string, unknown> => item !== null);
  if (!title || !logoUrl || normalizedItems.length < 3) {
    return null;
  }

  return {
    ...row,
    title,
    logoUrl,
    items: normalizedItems,
  };
}

function normalizeCollectionCardItem(value: unknown): Record<string, unknown> | null {
  const row = asRecord(value);
  const mediaType = readOptionalString(row.mediaType) ?? readOptionalString(row.media_type);
  const provider = readOptionalString(row.provider);
  const providerId = readOptionalString(row.providerId) ?? readOptionalString(row.provider_id);
  const title = readOptionalString(row.title);
  const posterUrl = readOptionalString(row.posterUrl) ?? readOptionalString(row.poster_url);
  if (!mediaType || !provider || !providerId || !title || !posterUrl) {
    return null;
  }

  return {
    ...row,
    mediaType,
    provider,
    providerId,
    title,
    posterUrl,
    releaseYear: readOptionalNumber(row.releaseYear) ?? readOptionalNumber(row.release_year),
    rating: readOptionalNumber(row.rating),
  };
}
