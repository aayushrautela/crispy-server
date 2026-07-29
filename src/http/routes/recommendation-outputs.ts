import type { FastifyInstance } from 'fastify';
import { HttpError } from '../../lib/errors.js';
import { RecommendationOutputService } from '../../modules/recommendations/recommendation-output.service.js';
import { HomeResolverService } from '../../modules/home/home-resolver.service.js';
import { HomeModeService } from '../../modules/home/home-mode.service.js';
import { success, successList } from '../response.js';
import { resolveRecommendationAlgorithmVersion, resolveRecommendationSourceKey } from '../../modules/recommendations/recommendation-config.js';

export async function registerRecommendationOutputRoutes(app: FastifyInstance): Promise<void> {
  const outputService = new RecommendationOutputService();
  const homeResolver = new HomeResolverService();
  const homeModeService = new HomeModeService();

  app.get('/v1/profiles/:profileId/taste-profiles', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    app.requireScopes(request, ['taste-profile:read']);
    const params = request.params as { profileId: string };
    return success({
      items: await outputService.listTasteProfilesForAccount(actor.appUserId, params.profileId),
    }, request);
  });

  app.get('/v1/profiles/:profileId/taste-profile', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    app.requireScopes(request, ['taste-profile:read']);
    const params = request.params as { profileId: string };
    const query = (request.query ?? {}) as Record<string, unknown>;
    const sourceKey = resolveRecommendationSourceKey(query.sourceKey);
    return success({
      tasteProfile: await outputService.getTasteProfileForAccount(actor.appUserId, params.profileId, sourceKey),
    }, request);
  });

  app.put('/v1/profiles/:profileId/taste-profile', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    app.requireScopes(request, ['taste-profile:write']);
    const params = request.params as { profileId: string };
    return success({
      tasteProfile: await outputService.upsertTasteProfileForAccount(actor.appUserId, params.profileId, parseTasteProfileInput(request.body)),
    }, request);
  });

  app.get('/v1/profiles/:profileId/home', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    app.requireScopes(request, ['recommendations:read']);
    const params = request.params as { profileId: string };
    const resolved = await homeResolver.resolveHome(actor.appUserId, params.profileId);
    return success({
      profileId: resolved.response.profileId,
      mode: resolved.mode,
      source: resolved.source,
      generatedAt: resolved.generatedAt,
      expiresAt: resolved.response.expiresAt,
      sections: resolved.response.sections,
    }, request);
  });

  app.put('/v1/profiles/:profileId/home', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    app.requireScopes(request, ['recommendations:write']);
    const params = request.params as { profileId: string };
    const idempotencyKey = request.headers['idempotency-key'];
    if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
      throw new HttpError(400, 'Idempotency-Key is required.', undefined, 'IDEMPOTENCY_KEY_REQUIRED');
    }
    const body = asRecord(request.body);
    const lists = parseHomeWriteBody(body);
    await homeModeService.assertCanWrite(actor.appUserId, params.profileId, 'custom');
    await homeResolver.writeHome({
      accountId: actor.appUserId,
      profileId: params.profileId,
      source: 'custom',
      idempotencyKey,
      actor: { type: 'account', accountId: actor.appUserId, userId: actor.appUserId },
      lists,
    });
    const resolved = await homeResolver.resolveHome(actor.appUserId, params.profileId);
    return success({
      profileId: resolved.response.profileId,
      mode: resolved.mode,
      source: resolved.source,
      generatedAt: resolved.generatedAt,
      expiresAt: resolved.response.expiresAt,
      sections: resolved.response.sections,
    }, request);
  });
}

function parseHomeWriteBody(body: Record<string, unknown>): Array<{ sectionType: 'categoryTabs' | 'heroCarousel' | 'contentRail' | 'collectionRail'; title: string; subtitle: string | null; items: Array<{ type: 'movie' | 'tv'; providerRefs: Array<{ provider: 'tmdb' | 'tvdb' | 'imdb' | 'kitsu'; providerId: string }>; metadata?: Record<string, unknown> }> }> {
  if (!Array.isArray(body.lists)) throw new HttpError(400, 'lists is required.', { field: 'lists' }, 'INVALID_HOME_WRITE');
  return body.lists.map((rawList, index) => {
    const listPath = `lists[${index}]`;
    const list = asRecord(rawList);
    const sectionType = list.sectionType;
    if (sectionType !== 'categoryTabs' && sectionType !== 'heroCarousel' && sectionType !== 'contentRail' && sectionType !== 'collectionRail') {
      throw new HttpError(400, `${listPath}.sectionType is invalid.`, { field: `${listPath}.sectionType` }, 'INVALID_SECTION_TYPE');
    }
    if (typeof list.title !== 'string' || !list.title.trim()) throw new HttpError(400, `${listPath}.title is required.`, { field: `${listPath}.title` }, 'INVALID_TITLE');
    if (!Array.isArray(list.items)) throw new HttpError(400, `${listPath}.items must be an array.`, { field: `${listPath}.items` }, 'INVALID_ITEMS');
    const items = list.items.map((rawItem, itemIndex) => {
      const itemPath = `${listPath}.items[${itemIndex}]`;
      const item = asRecord(rawItem);
      const type = item.type;
      if (type !== 'movie' && type !== 'tv') throw new HttpError(400, `${itemPath}.type must be movie or tv.`, { field: `${itemPath}.type` }, 'INVALID_ITEM_TYPE');
      if (!Array.isArray(item.providerRefs) || item.providerRefs.length === 0) throw new HttpError(400, `${itemPath}.providerRefs is required.`, { field: `${itemPath}.providerRefs` }, 'INVALID_PROVIDER_REF');
      const ref = asRecord(item.providerRefs[0]);
      const provider = ref.provider;
      if (provider !== 'tmdb' && provider !== 'tvdb' && provider !== 'imdb' && provider !== 'kitsu') throw new HttpError(400, `${itemPath}.providerRefs[0].provider is invalid.`, { field: `${itemPath}.providerRefs[0].provider` }, 'INVALID_PROVIDER');
      if (typeof ref.providerId !== 'string' || !ref.providerId.trim()) throw new HttpError(400, `${itemPath}.providerRefs[0].providerId is required.`, { field: `${itemPath}.providerRefs[0].providerId` }, 'INVALID_PROVIDER_ID');
      return {
        type: type as 'movie' | 'tv',
        providerRefs: [{ provider: provider as 'tmdb' | 'tvdb' | 'imdb' | 'kitsu', providerId: String(ref.providerId) }],
        ...(item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata) ? { metadata: item.metadata as Record<string, unknown> } : {}),
      };
    });
    return {
      sectionType,
      title: list.title,
      subtitle: typeof list.subtitle === 'string' ? list.subtitle : null,
      items,
    };
  });
}

function parseTasteProfileInput(body: unknown) {
  const value = asRecord(body);
  return {
    sourceKey: resolveRecommendationSourceKey(value.sourceKey),
    genres: Array.isArray(value.genres) ? value.genres : [],
    preferredActors: Array.isArray(value.preferredActors) ? value.preferredActors : [],
    preferredDirectors: Array.isArray(value.preferredDirectors) ? value.preferredDirectors : [],
    contentTypePref: asRecord(value.contentTypePref),
    ratingTendency: asRecord(value.ratingTendency),
    decadePreferences: Array.isArray(value.decadePreferences) ? value.decadePreferences : [],
    watchingPace: typeof value.watchingPace === 'string' ? value.watchingPace : null,
    aiSummary: typeof value.aiSummary === 'string' ? value.aiSummary : null,
    source: typeof value.source === 'string' && value.source.trim() ? value.source.trim() : 'manual',
  };
}

function parseRecommendationSnapshotInput(body: unknown) {
  const value = asRecord(body);
  const algorithmVersion = resolveRecommendationAlgorithmVersion(value.algorithmVersion);

  const historyGeneration = Number(value.historyGeneration);
  if (!Number.isInteger(historyGeneration) || historyGeneration < 0) {
    throw new HttpError(400, 'historyGeneration must be a non-negative integer.');
  }

  const generatedAt = typeof value.generatedAt === 'string' && value.generatedAt.trim() ? value.generatedAt : null;
  if (!generatedAt) {
    throw new HttpError(400, 'generatedAt is required.');
  }

  return {
    sourceKey: resolveRecommendationSourceKey(value.sourceKey),
    historyGeneration,
    algorithmVersion,
    sourceCursor: typeof value.sourceCursor === 'string' ? value.sourceCursor : null,
    generatedAt,
    expiresAt: typeof value.expiresAt === 'string' ? value.expiresAt : null,
    source: typeof value.source === 'string' && value.source.trim() ? value.source.trim() : 'manual',
    updatedById: typeof value.updatedById === 'string' ? value.updatedById : null,
    sections: Array.isArray(value.sections) ? value.sections : [],
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
