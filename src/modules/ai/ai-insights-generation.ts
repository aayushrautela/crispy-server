import { logger } from '../../config/logger.js';
import { withDbClient } from '../../lib/db.js';
import { FeatureEntitlementService } from '../entitlements/feature-entitlement.service.js';
import { MetadataReviewsService } from '../metadata/metadata-reviews.service.js';
import type { MetadataReviewView, MetadataTitleDetail } from '../metadata/metadata-detail.types.js';
import { MetadataTitlePageService } from '../metadata/metadata-title-page.service.js';
import { TmdbClient } from '../metadata/providers/tmdb.client.js';
import { AiInsightsCacheRepository } from './ai-insights-cache.repo.js';
import { buildInsightsSystemPrompt, buildInsightsUserPrompt, type TitleInsightsContext } from './ai-prompts.js';
import { AiRequestExecutor } from './ai-request-executor.js';
import { buildAiInsightsGenerationVersion } from './ai-provider-resolver.js';
import type { AiInsightsPayload } from './ai.types.js';

const GENERATION_VERSION = 'v7';

/**
 * Cold-path generation, run by the worker so the request path never blocks on
 * the LLM. Resolves the prompt context, generates, and writes the cache row
 * (payload + backdrop paths). Never throws on recoverable failures — it simply
 * leaves the cache empty so the waiting request can surface its own error. The
 * job wrapper guarantees no retry.
 */
export async function generateInsightsIntoCache(params: {
  userId: string;
  profileId: string;
  itemId: string;
  contentId: string;
  locale: string;
}): Promise<void> {
  const entitlementService = new FeatureEntitlementService();
  const metadataTitlePageService = new MetadataTitlePageService();
  const metadataReviewsService = new MetadataReviewsService();
  const aiRequestExecutor = new AiRequestExecutor();
  const tmdbClient = new TmdbClient();
  const cacheRepository = new AiInsightsCacheRepository();

  const titleDetail = await metadataTitlePageService.getTitlePage(params.itemId);
  const backdropPaths = await fetchBackdropPaths(tmdbClient, titleDetail);
  const titleReviews = await metadataReviewsService.getTitleReviews(params.userId, params.profileId, params.itemId);
  const titleContext = buildTitleInsightsContext(titleDetail, titleReviews.Reviews);
  if (!titleContext) {
    logger.warn({ itemId: params.itemId, locale: params.locale }, 'AI insights generation skipped: no title context');
    return;
  }

  const execution = await aiRequestExecutor.generateJsonForUser({
    userId: params.userId,
    feature: 'insights',
    systemPrompt: buildInsightsSystemPrompt(),
    userPrompt: buildInsightsUserPrompt(titleContext),
  });
  const generated = execution.payload;
  const actualGenerationVersion = `${GENERATION_VERSION}:${buildAiInsightsGenerationVersion(execution.request)}`;
  const payload = normalizeInsightsPayload(generated);
  if (!payload) {
    logger.warn({ itemId: params.itemId, locale: params.locale }, 'AI insights generation skipped: provider returned invalid data');
    return;
  }

  await withDbClient(async (client) => {
    await cacheRepository.upsert(client, {
      contentId: params.contentId,
      locale: params.locale,
      generationVersion: actualGenerationVersion,
      modelName: `${execution.request.providerId}:${execution.request.model}`,
      payload,
      generatedByProfileId: params.profileId,
      backdropPaths,
    });
  });

  logger.info({
    itemId: params.itemId,
    locale: params.locale,
    providerId: execution.request.providerId,
    model: execution.request.model,
  }, 'AI insights generated');
}

/** Live TMDB artwork paths for insight slides. Never fails the request. */
export async function fetchBackdropPaths(tmdbClient: TmdbClient, titleDetail: MetadataTitleDetail): Promise<string[]> {
  try {
    const mediaType = titleDetail.Item.mediaType;
    const tmdbId = Number(titleDetail.Item.providerIds?.tmdb);
    if ((mediaType !== 'movie' && mediaType !== 'tv') || !Number.isFinite(tmdbId) || tmdbId <= 0) {
      return [];
    }
    const images = await tmdbClient.request(`/${mediaType}/${tmdbId}/images`);
    const backdrops = Array.isArray(images.backdrops) ? images.backdrops : [];
    return backdrops
      .map((entry) => (entry && typeof entry === 'object' ? (entry as Record<string, unknown>).file_path : null))
      .filter((path): path is string => typeof path === 'string' && path.trim().length > 0)
      .slice(0, 5);
  } catch {
    return [];
  }
}

export function buildTitleInsightsContext(detail: MetadataTitleDetail, reviews: MetadataReviewView[]): TitleInsightsContext | null {
  const mediaType = detail.Item.mediaType;
  if (mediaType !== 'movie' && mediaType !== 'tv') {
    return null;
  }

  const title = detail.Item.title?.trim() ?? '';
  if (!title) {
    return null;
  }

  return {
    itemId: detail.Item.itemId,
    mediaType: mediaType === 'movie' ? 'movie' : 'show',
    title,
    year: detail.Item.year ? String(detail.Item.year) : null,
    description: detail.Item.overview?.trim() || null,
    rating: typeof detail.Item.rating === 'number' && Number.isFinite(detail.Item.rating)
      ? detail.Item.rating.toFixed(1)
      : null,
    genres: detail.Item.genres,
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

export function normalizeInsightsPayload(payload: Record<string, unknown>): AiInsightsPayload | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }

  const goodStuff = typeof payload.the_good_stuff === 'string' ? payload.the_good_stuff.trim() : '';
  const theCatch = typeof payload.the_catch === 'string' ? payload.the_catch.trim() : '';
  const trivia = typeof payload.trivia === 'string' ? payload.trivia.trim() : '';
  const standout = payload.standout_element;

  // At least one of positive/negative must carry real feedback; both may be omitted.
  if ((!goodStuff && !theCatch) || !trivia || !standout || typeof standout !== 'object' || Array.isArray(standout)) {
    return null;
  }

  const standoutRecord = standout as Record<string, unknown>;
  const validTags = ['PERFORMANCE', 'VISUALS', 'STORY', 'DIRECTION', 'WORLD_BUILDING'];
  const tag = typeof standoutRecord.tag === 'string' ? standoutRecord.tag : '';
  const focus = typeof standoutRecord.focus === 'string' ? standoutRecord.focus.trim() : '';
  const context = typeof standoutRecord.context === 'string' ? standoutRecord.context.trim() : '';
  if (!validTags.includes(tag) || !focus || !context) {
    return null;
  }

  return {
    the_good_stuff: goodStuff || null,
    the_catch: theCatch || null,
    standout_element: {
      tag: tag as AiInsightsPayload['standout_element']['tag'],
      focus,
      context,
    },
    trivia,
  };
}
