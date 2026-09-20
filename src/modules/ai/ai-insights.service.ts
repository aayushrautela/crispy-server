import { logger } from '../../config/logger.js';
import { env } from '../../config/env.js';
import { withTransaction, type DbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { FeatureEntitlementService } from '../entitlements/feature-entitlement.service.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { assertPublicItemId, decodePublicItemId } from '../identity/public-item-id.js';
import { MetadataReviewsService } from '../metadata/metadata-reviews.service.js';
import type { MetadataTitleDetail } from '../metadata/metadata-detail.types.js';
import { MetadataTitlePageService } from '../metadata/metadata-title-page.service.js';
import { TmdbClient } from '../metadata/providers/tmdb.client.js';
import type { ResponsiveImageSet } from '../metadata/metadata-card.types.js';
import { buildResponsiveImageSet, emptyResponsiveImageSet } from '../metadata/metadata-builder.shared.js';
import { ProfileLocalService } from '../profiles/profile-local.service.js';
import { AiInsightsCacheRepository } from './ai-insights-cache.repo.js';
import { AiRequestExecutor } from './ai-request-executor.js';
import { buildAiInsightsGenerationVersion } from './ai-provider-resolver.js';
import { fetchBackdropPaths } from './ai-insights-generation.js';
import { BullMqAiGenerationGateway, type AiGenerationGateway } from './ai-generation.gateway.js';
import type { AiInsightsPayload, AiInsightsResponse, AiInsightSlide } from './ai.types.js';

const GENERATION_VERSION = 'v7';

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
    private readonly tmdbClient = new TmdbClient(),
    private readonly runInTransaction: TransactionRunner = withTransaction,
    private readonly aiGenerationGateway: AiGenerationGateway = new BullMqAiGenerationGateway(),
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

    const cached = await this.readCache(contentId, locale, generationVersion);
    if (cached) {
      return this.serveFromCache(cached, titleDetail, {
        contentId, locale, generationVersion, userId, profileId, itemId, cacheHit: true,
      });
    }

    // Cold path: delegate generation to the worker and wait on it (bounded).
    // The deterministic job id coalesces every concurrent caller for the same
    // content+locale+version onto a single generation, so a burst produces one
    // LLM call instead of N.
    const handle = await this.aiGenerationGateway.enqueueInsights({
      userId,
      profileId,
      itemId,
      contentId,
      locale,
      generationVersion,
    });
    // The wait is a notification channel only; the cache row is the source of
    // truth. waitUntilFinished rejects on job failure AND on missed completion
    // events (QueueEvents readiness race / removed jobs) — either way we must
    // still re-read the cache, because a successful worker writes the row
    // regardless of whether the event arrived.
    try {
      await this.aiGenerationGateway.waitForInsights(handle, env.aiRequestWaitMs);
    } catch (error) {
      logger.warn(
        { userId, profileId, itemId, locale, err: error },
        'AI insights wait did not confirm completion; re-reading cache',
      );
    }

    const refreshed = await this.readCache(contentId, locale, generationVersion);
    if (!refreshed) {
      throw new HttpError(504, 'AI insights generation timed out.');
    }
    return this.serveFromCache(refreshed, titleDetail, {
      contentId, locale, generationVersion, userId, profileId, itemId, cacheHit: false,
    });
  }

  private async readCache(
    contentId: string,
    locale: string,
    generationVersion: string,
  ): Promise<{ payload: AiInsightsPayload; backdropPaths: string[] | null } | null> {
    return this.runInTransaction(async (client) => {
      return this.cacheRepository.findByKey(client, {
        contentId,
        locale,
        generationVersion,
      });
    });
  }

  private async serveFromCache(
    cached: { payload: AiInsightsPayload; backdropPaths: string[] | null },
    titleDetail: MetadataTitleDetail,
    ctx: { contentId: string; locale: string; generationVersion: string; userId: string; profileId: string; itemId: string; cacheHit: boolean },
  ): Promise<AiInsightsResponse> {
    // Cache hits serve entirely from storage; no live TMDB work on the hot path.
    // Legacy rows (written before backdrop_paths existed) self-heal by fetching
    // backdrops once and writing them back.
    const backdropPaths = cached.backdropPaths ?? await fetchBackdropPaths(this.tmdbClient, titleDetail);
    const backdropBackfilled = cached.backdropPaths === null;
    if (backdropBackfilled) {
      await this.runInTransaction(async (client) => {
        await this.cacheRepository.updateBackdropPaths(client, {
          contentId: ctx.contentId,
          locale: ctx.locale,
          generationVersion: ctx.generationVersion,
          backdropPaths,
        });
      });
    }
    logger.info({
      userId: ctx.userId,
      profileId: ctx.profileId,
      itemId: ctx.itemId,
      locale: ctx.locale,
      cacheHit: ctx.cacheHit,
      backdropBackfilled,
    }, 'AI insights served from cache');
    return this.buildSlides(cached.payload, titleDetail, backdropPaths);
  }

  /** Live TMDB artwork for insight slides. Never fails the request. */
  private buildSlides(payload: AiInsightsPayload, titleDetail: MetadataTitleDetail, backdropPaths: string[]): AiInsightsResponse {
    const backdrops = backdropPaths
      .map((path) => buildResponsiveImageSet(path, BACKDROP_IMAGE_SIZES))
      .filter((set): set is ResponsiveImageSet => Boolean(set.small || set.medium || set.large));
    const candidates = backdrops.length > 0 ? backdrops : (titleDetail.Item.images.artwork ? [titleDetail.Item.images.artwork] : []);

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

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeLocale(value: unknown): string {
  const normalized = normalizeString(value);
  return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/.test(normalized) ? normalized : 'en-US';
}
