import { withTransaction, type DbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { FeatureEntitlementService } from '../entitlements/feature-entitlement.service.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { assertPublicItemId, decodePublicItemId } from '../identity/public-item-id.js';
import { MetadataReviewsService } from '../metadata/metadata-reviews.service.js';
import type { MetadataReviewView, MetadataTitleDetail } from '../metadata/metadata-detail.types.js';
import { MetadataTitlePageService } from '../metadata/metadata-title-page.service.js';
import type { ResponsiveImageSet } from '../metadata/metadata-card.types.js';
import { buildResponsiveImageSet, emptyResponsiveImageSet } from '../metadata/metadata-builder.shared.js';
import { ProfileLocalService } from '../profiles/profile-local.service.js';
import { AiInsightsCacheRepository } from './ai-insights-cache.repo.js';
import { buildInsightsPrompt, type TitleInsightsContext } from './ai-prompts.js';
import { AiRequestExecutor } from './ai-request-executor.js';
import { buildAiInsightsGenerationVersion } from './ai-provider-resolver.js';
import type { AiInsightsPayload, AiInsightsResponse, AiInsightSlide } from './ai.types.js';

const GENERATION_VERSION = 'v6';

const SLIDE_ACCENTS: Record<AiInsightSlide['key'], string> = {
  the_good_stuff: '#7c5cff',
  the_catch: '#ff7c5c',
  standout_element: '#5cc8ff',
  trivia: '#ffd75c',
};

/** Fixed backdrop slot per slide key so colors/images never shift when slides are omitted. */
const SLIDE_BACKDROP_SLOTS: Record<AiInsightSlide['key'], number> = {
  the_good_stuff: 0,
  the_catch: 1,
  standout_element: 2,
  trivia: 3,
};

const BACKDROP_IMAGE_SIZES = { small: 'w780', medium: 'w1280', large: 'original' } as const;

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
  }): Promise<AiInsightsResponse> {
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

    const titleDetail = await this.metadataTitlePageService.getTitlePage(itemId);

    const cached = await this.runInTransaction(async (client) => {
      return this.cacheRepository.findByKey(client, {
        contentId,
        locale,
        generationVersion,
      });
    });
    if (cached) {
      return this.buildSlides(cached.payload, titleDetail);
    }

    const titleReviews = await this.metadataReviewsService.getTitleReviews(userId, profileId, itemId);
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

    await this.runInTransaction(async (client) => {
      await this.cacheRepository.upsert(client, {
        contentId,
        locale,
        generationVersion: actualGenerationVersion,
        modelName: `${execution.request.providerId}:${execution.request.model}`,
        payload,
        generatedByProfileId: profileId,
      });
    });

    return this.buildSlides(payload, titleDetail);
  }

  private buildSlides(payload: AiInsightsPayload, titleDetail: MetadataTitleDetail): AiInsightsResponse {
    const backdropPaths = titleDetail.Backdrops ?? [];
    const backdrops = backdropPaths
      .map((path) => buildResponsiveImageSet(path, BACKDROP_IMAGE_SIZES))
      .filter((set): set is ResponsiveImageSet => Boolean(set.small || set.medium || set.large));
    const candidates = backdrops.length > 0 ? backdrops : (titleDetail.Item.ImageTags.Backdrop ?? []);

    const pickBackdrop = (index: number): ResponsiveImageSet => {
      if (candidates.length === 0) {
        return emptyResponsiveImageSet();
      }
      return candidates[index % candidates.length] ?? emptyResponsiveImageSet();
    };

    const slides: AiInsightSlide[] = [];
    if (payload.the_good_stuff) {
      slides.push({
        key: 'the_good_stuff',
        label: 'The Good Stuff',
        kind: 'prose',
        body: payload.the_good_stuff,
        tag: null,
        focus: null,
        context: null,
        backdrop: pickBackdrop(SLIDE_BACKDROP_SLOTS.the_good_stuff),
        accent: SLIDE_ACCENTS.the_good_stuff,
      });
    }
    if (payload.the_catch) {
      slides.push({
        key: 'the_catch',
        label: 'The Catch',
        kind: 'prose',
        body: payload.the_catch,
        tag: null,
        focus: null,
        context: null,
        backdrop: pickBackdrop(SLIDE_BACKDROP_SLOTS.the_catch),
        accent: SLIDE_ACCENTS.the_catch,
      });
    }
    slides.push({
      key: 'standout_element',
      label: 'Standout',
      kind: 'standout',
      body: null,
      tag: payload.standout_element.tag,
      focus: payload.standout_element.focus,
      context: payload.standout_element.context,
      backdrop: pickBackdrop(SLIDE_BACKDROP_SLOTS.standout_element),
      accent: SLIDE_ACCENTS.standout_element,
    });
    slides.push({
      key: 'trivia',
      label: 'Did You Know?',
      kind: 'trivia',
      body: payload.trivia,
      tag: null,
      focus: null,
      context: null,
      backdrop: pickBackdrop(SLIDE_BACKDROP_SLOTS.trivia),
      accent: SLIDE_ACCENTS.trivia,
    });

    return { slides };
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

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeLocale(value: unknown): string {
  const normalized = normalizeString(value);
  return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/.test(normalized) ? normalized : 'en-US';
}
