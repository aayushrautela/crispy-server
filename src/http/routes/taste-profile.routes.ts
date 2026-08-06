import type { FastifyInstance } from 'fastify';
import { HttpError } from '../../lib/errors.js';
import { TasteProfileService } from '../../modules/recommendations/taste-profile.service.js';
import { HomeResolverService } from '../../modules/home/home-resolver.service.js';
import { HomeModeService } from '../../modules/home/home-mode.service.js';
import { parseRecoListWriteRequest } from '../../modules/recommendations/reco-list-write-parser.js';
import { success, successList } from '../response.js';
import { resolveRecommendationSourceKey } from '../../modules/recommendations/recommendation-config.js';

export async function registerTasteProfileRoutes(app: FastifyInstance): Promise<void> {
  const outputService = new TasteProfileService();
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
    const lists = parseRecoListWriteRequest(request.body).lists;
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

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
