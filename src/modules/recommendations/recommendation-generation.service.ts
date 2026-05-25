import { withDbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { logger } from '../../config/logger.js';
import { FeatureEntitlementService } from '../entitlements/feature-entitlement.service.js';
import { ProfileRepository } from '../profiles/profile.repo.js';
import { ProfileInputSignalFacade } from './profile-input-signal.facade.js';
import { recommendationConfig } from './recommendation-config.js';
import { RecommendationOutputService } from './recommendation-output.service.js';
import { RecommendationSnapshotsRepository } from './recommendation-snapshots.repo.js';
import { ProfileWatchDataStateRepository } from '../integrations/profile-watch-data-state.repo.js';
import type {
  RecommendationSignalBundle,
  RecommendationSignalGenerationResponse,
} from './recommendation-signal.types.js';
import type {
  ProfileInputContinueWatchingItem,
  ProfileInputRatingItem,
  ProfileInputWatchHistoryItem,
  ProfileInputWatchlistItem,
} from './profile-input-signal.types.js';
import type { BaseItemDto } from '../metadata/media-item.types.js';
import type { RecoContinueSignal, RecoItemRef, RecoMediaType, RecoProviderRef } from './reco-contract.types.js';

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
    private readonly profileInputSignalFacade = new ProfileInputSignalFacade({
      defaults: {
        historyDefault: 100,
        historyMax: 500,
        ratingsDefault: 100,
        ratingsMax: 500,
        watchlistDefault: 50,
        watchlistMax: 200,
        continueDefault: 20,
        continueMax: 50,
        trackedSeriesDefault: 20,
        trackedSeriesMax: 100,
      },
    }),
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
    const signals = await this.profileInputSignalFacade.getBundle({
      accountId: context.accountId,
      profileId: context.profileId,
      include: ['history', 'ratings', 'watchlist', 'continue', 'trackedSeries'],
      limits: {
        historyLimit: limits.watchHistory,
        ratingsLimit: limits.ratings,
        watchlistLimit: limits.watchlist,
        continueLimit: limits.continueWatching,
        trackedSeriesLimit: limits.trackedSeries,
      },
    });

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
      watchHistory: signals.history ? signals.history.flatMap(mapInputHistoryItem) : [],
      ratings: signals.ratings ? signals.ratings.flatMap(mapInputRatingItem) : [],
      watchlist: signals.watchlist ? signals.watchlist.flatMap(mapInputWatchlistItem) : [],
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
        continueWatching: signals.continueWatching ? signals.continueWatching.flatMap(mapInputContinueWatchingSignals) : [],
        limits,
      },
    };
  }
}

export function mapContinueWatchingItem(item: ProfileInputContinueWatchingItem): RecoContinueSignal | null {
  return mapInputContinueWatchingItem(item);
}

function mapInputHistoryItem(item: ProfileInputWatchHistoryItem): Array<RecommendationSignalBundle['watchHistory'][number]> {
  const recoItem = toRecoItemRef(item.Item);
  if (!recoItem) return [];
  return [{
    item: recoItem,
    watchedAt: new Date(item.watchedAt),
    progressPercent: readSignalNumber(item.payload?.progressPercent, 100),
    completionState: readCompletionState(item.payload?.completionState),
    durationSeconds: item.Item.RunTimeTicks !== null ? item.Item.RunTimeTicks / 10_000_000 : null,
  }];
}

function mapInputRatingItem(item: ProfileInputRatingItem): Array<RecommendationSignalBundle['ratings'][number]> {
  const recoItem = toRecoItemRef(item.Item);
  if (!recoItem) return [];
  return [{
    item: recoItem,
    rating: item.rating.value,
    ratedAt: new Date(item.rating.ratedAt),
    ratingSource: readSignalOptionalString(item.payload?.ratingSource),
  }];
}

function mapInputWatchlistItem(item: ProfileInputWatchlistItem): Array<RecommendationSignalBundle['watchlist'][number]> {
  const recoItem = toRecoItemRef(item.Item);
  if (!recoItem) return [];
  return [{
    item: recoItem,
    addedAt: new Date(item.addedAt),
  }];
}

export function mapInputContinueWatchingItem(item: ProfileInputContinueWatchingItem): RecoContinueSignal | null {
  const signals = mapInputContinueWatchingSignals(item);
  return signals[0] ?? null;
}

function mapInputContinueWatchingSignals(item: ProfileInputContinueWatchingItem): RecoContinueSignal[] {
  const recoItem = toRecoItemRef(item.Item);
  if (!recoItem) return [];
  return [{
    item: recoItem,
    progressPercent: item.progress.progressPercent,
    updatedAt: new Date(item.lastActivityAt),
  }];
}

function toRecoItemRef(item: BaseItemDto): RecoItemRef | null {
  const type = toRecoMediaType(item.Type);
  if (!type) return null;
  const providerRefs = toProviderRefs(item);
  if (providerRefs.length === 0) return null;
  return { type, providerRefs };
}

function toRecoMediaType(type: BaseItemDto['Type']): RecoMediaType | null {
  switch (type) {
    case 'Movie': return 'movie';
    case 'Series': return 'tv';
    default: return null;
  }
}

function toProviderRefs(item: BaseItemDto): RecoProviderRef[] {
  const refs: RecoProviderRef[] = [];
  if (item.ProviderIds.Tmdb) refs.push({ provider: 'tmdb', providerId: item.ProviderIds.Tmdb });
  if (item.ProviderIds.Tvdb) refs.push({ provider: 'tvdb', providerId: item.ProviderIds.Tvdb });
  if (item.ProviderIds.Imdb) refs.push({ provider: 'imdb', providerId: item.ProviderIds.Imdb });
  return refs;
}

function readSignalNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function readCompletionState(value: unknown): 'completed' | 'partial' | 'unknown' {
  if (value === 'completed' || value === 'partial' || value === 'unknown') return value;
  return 'completed';
}

function readSignalOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
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
  const sectionType = row.sectionType === 'categoryTabs' || row.sectionType === 'heroCarousel' || row.sectionType === 'contentRail' || row.sectionType === 'collectionRail'
    ? row.sectionType
    : 'contentRail';
  const items = Array.isArray(row.items) ? row.items : [];
  const normalizedItems = items.map((item) => normalizeMediaItem(item)).filter((item): item is Record<string, unknown> => item !== null);

  return {
    ...row,
    id: readOptionalString(row.id) ?? 'recommended',
    title: readOptionalString(row.title) ?? 'Recommended',
    sectionType,
    meta: asRecord(row.meta),
    items: normalizedItems,
  };
}

function normalizeMediaItem(value: unknown): Record<string, unknown> | null {
  const row = asRecord(value);
  const itemId = readOptionalString(row.itemId);
  if (!itemId) {
    return null;
  }

  return {
    ...row,
    itemId,
    reason: readOptionalString(row.reason),
    score: readOptionalNumber(row.score),
    rank: readOptionalNumber(row.rank),
    payload: asRecord(row.payload),
  };
}

