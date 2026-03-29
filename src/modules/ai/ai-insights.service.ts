import { withTransaction } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { MetadataQueryService } from '../metadata/metadata-query.service.js';
import type { MetadataTitleDetail } from '../metadata/metadata.types.js';
import { ProfileRepository } from '../profiles/profile.repo.js';
import { AiInsightsCacheRepository } from './ai-insights-cache.repo.js';
import { buildInsightsPrompt, type TitleInsightsContext } from './ai-prompts.js';
import { AiRequestExecutor } from './ai-request-executor.js';
import { AiProviderResolver, buildAiInsightsGenerationVersion } from './ai-provider-resolver.js';
import type { AiInsightsPayload } from './ai.types.js';

const GENERATION_VERSION = 'v3';

export class AiInsightsService {
  constructor(
    private readonly profileRepository = new ProfileRepository(),
    private readonly cacheRepository = new AiInsightsCacheRepository(),
    private readonly aiProviderResolver = new AiProviderResolver(),
    private readonly aiRequestExecutor = new AiRequestExecutor(),
    private readonly metadataQueryService = new MetadataQueryService(),
  ) {}

  async getInsights(userId: string, input: {
    contentId: string;
    profileId: string;
    locale?: string | null;
  }): Promise<AiInsightsPayload> {
    const contentId = normalizeString(input.contentId);
    const profileId = normalizeString(input.profileId);
    const locale = normalizeLocale(input.locale);

    if (!contentId) {
      throw new HttpError(400, 'contentId is required.');
    }
    if (!profileId) {
      throw new HttpError(400, 'Profile is required.');
    }
    await withTransaction(async (client) => {
      const profile = await this.profileRepository.findByIdForOwnerUser(client, profileId, userId);
      if (!profile) {
        throw new HttpError(404, 'Profile not found.');
      }
    });
    const request = await this.aiProviderResolver.resolveForUser(userId, 'insights');
    const generationVersion = `${GENERATION_VERSION}:${buildAiInsightsGenerationVersion(request)}`;

    const cached = await withTransaction(async (client) => {
      return this.cacheRepository.findByKey(client, {
        contentId,
        locale,
        generationVersion,
      });
    });
    if (cached) {
      return cached.payload;
    }

    const titleDetail = await this.metadataQueryService.getTitleDetailById(contentId);
    const titleContext = buildTitleInsightsContext(titleDetail);
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

    return withTransaction(async (client) => {
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

function buildTitleInsightsContext(detail: MetadataTitleDetail): TitleInsightsContext | null {
  const mediaType = detail.item.mediaType;
  if (mediaType !== 'movie' && mediaType !== 'show' && mediaType !== 'anime') {
    return null;
  }

  const title = detail.item.title?.trim() ?? '';
  if (!title) {
    return null;
  }

  return {
    contentId: detail.item.id,
    mediaType,
    title,
    year: detail.item.releaseYear ? String(detail.item.releaseYear) : null,
    description: detail.item.overview?.trim() || detail.item.summary?.trim() || null,
    rating: typeof detail.item.rating === 'number' && Number.isFinite(detail.item.rating)
      ? detail.item.rating.toFixed(1)
      : null,
    genres: detail.item.genres,
    reviews: detail.reviews
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
