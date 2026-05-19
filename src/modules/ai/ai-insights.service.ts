import { withTransaction, type DbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { FeatureEntitlementService } from '../entitlements/feature-entitlement.service.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { assertPublicItemId, decodePublicItemId } from '../identity/public-item-id.js';
import { MetadataReviewsService } from '../metadata/metadata-reviews.service.js';
import type { MetadataReviewView, MetadataTitleDetail } from '../metadata/metadata-detail.types.js';
import { MetadataTitlePageService } from '../metadata/metadata-title-page.service.js';
import { ProfileLocalService } from '../profiles/profile-local.service.js';
import { AiInsightsCacheRepository } from './ai-insights-cache.repo.js';
import { buildInsightsPrompt, type TitleInsightsContext } from './ai-prompts.js';
import { AiRequestExecutor } from './ai-request-executor.js';
import { buildAiInsightsGenerationVersion } from './ai-provider-resolver.js';
import type { AiInsightsPayload } from './ai.types.js';

const GENERATION_VERSION = 'v4';

type TransactionRunner = <T>(work: (client: DbClient) => Promise<T>) => Promise<T>;

export class AiInsightsService {
  constructor(
    private readonly profileLocalService = new ProfileLocalService(),
    private readonly cacheRepository = new AiInsightsCacheRepository(),
    private readonly contentIdentityService = new ContentIdentityService(),
    private readonly entitlementService = new FeatureEntitlementService(),
    private readonly aiRequestExecutor = new AiRequestExecutor(),
    private readonly metadataTitlePageService = new MetadataTitlePageService(),
    private readonly metadataReviewsService = new MetadataReviewsService(),
    private readonly runInTransaction: TransactionRunner = withTransaction,
  ) {}

  async getInsights(userId: string, input: {
    itemId: string;
    profileId: string;
    locale?: string | null;
  }): Promise<AiInsightsPayload> {
    const itemId = normalizeString(input.itemId);
    const profileId = normalizeString(input.profileId);
    const locale = normalizeLocale(input.locale);

    if (!itemId) {
      throw new HttpError(400, 'itemId is required.');
    }
    assertPublicItemId(itemId);
    if (!profileId) {
      throw new HttpError(400, 'Profile is required.');
    }
    await this.profileLocalService.requireOwnedProfile(userId, profileId);
    const contentId = decodePublicItemId(itemId);
    const request = await this.entitlementService.resolveAiRequestForUser(userId, 'insights');
    const generationVersion = `${GENERATION_VERSION}:${buildAiInsightsGenerationVersion(request)}`;

    const cached = await this.runInTransaction(async (client) => {
      return this.cacheRepository.findByKey(client, {
        contentId,
        locale,
        generationVersion,
      });
    });
    if (cached) {
      return cached.payload;
    }

    const [titleDetail, titleReviews] = await Promise.all([
      this.metadataTitlePageService.getTitlePage(itemId),
      this.metadataReviewsService.getTitleReviews(userId, profileId, itemId),
    ]);
    const titleContext = buildTitleInsightsContext(titleDetail, titleReviews.Reviews);
    if (!titleContext) {
      throw new HttpError(404, 'Unable to load title data for AI insights.');
    }

    const execution = await this.aiRequestExecutor.generateJsonForUser({
      userId,
      feature: 'insights',
      userPrompt: buildInsightsPrompt(titleContext),
    });
    const generated = execution.payload;
    const actualGenerationVersion = `${GENERATION_VERSION}:${buildAiInsightsGenerationVersion(execution.request)}`;
    const payload = normalizeInsightsPayload(generated);
    if (!payload) {
      throw new HttpError(502, 'AI insights returned invalid data.');
    }

    return this.runInTransaction(async (client) => {
      return this.cacheRepository.upsert(client, {
        contentId,
        locale,
        generationVersion: actualGenerationVersion,
        modelName: `${execution.request.providerId}:${execution.request.model}`,
        payload,
        generatedByProfileId: profileId,
      });
    });
  }
}

function buildTitleInsightsContext(detail: MetadataTitleDetail, reviews: MetadataReviewView[]): TitleInsightsContext | null {
  const mediaType = detail.Item.Type;
  if (mediaType !== 'Movie' && mediaType !== 'Series') {
    return null;
  }

  const title = detail.Item.Name?.trim() ?? '';
  if (!title) {
    return null;
  }

  return {
    itemId: detail.Item.Id,
    mediaType: mediaType === 'Movie' ? 'movie' : 'show',
    title,
    year: detail.Item.ProductionYear ? String(detail.Item.ProductionYear) : null,
    description: detail.Item.Overview?.trim() || null,
    rating: typeof detail.Item.CommunityRating === 'number' && Number.isFinite(detail.Item.CommunityRating)
      ? detail.Item.CommunityRating.toFixed(1)
      : null,
    genres: detail.Item.Genres,
    reviews: reviews
      .map((review) => ({
        author: review.author?.trim() || review.username?.trim() || 'Unknown',
        rating: review.rating,
        content: review.content.trim(),
      }))
      .filter((review) => review.content)
      .slice(0, 10),
  };
}

function normalizeInsightsPayload(payload: Record<string, unknown>): AiInsightsPayload | null {
  const trivia = typeof payload.trivia === 'string' ? payload.trivia.trim() : '';
  const items = Array.isArray(payload.insights) ? payload.insights : [];
  const insights = items
    .map((item) => normalizeInsightCard(item))
    .filter((item): item is AiInsightsPayload['insights'][number] => item !== null)
    .slice(0, 3);

  if (insights.length === 0) {
    return null;
  }

  return {
    insights,
    trivia,
  };
}

function normalizeInsightCard(value: unknown): AiInsightsPayload['insights'][number] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const item = value as Record<string, unknown>;
  const type = typeof item.type === 'string' ? item.type.trim() : '';
  const title = typeof item.title === 'string' ? item.title.trim() : '';
  const category = typeof item.category === 'string' ? item.category.trim() : '';
  const content = typeof item.content === 'string' ? item.content.trim() : '';
  if (!type || !title || !category || !content) {
    return null;
  }
  return { type, title, category, content };
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeLocale(value: unknown): string {
  const normalized = normalizeString(value);
  return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/.test(normalized) ? normalized : 'en-US';
}
