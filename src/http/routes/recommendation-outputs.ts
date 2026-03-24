import type { FastifyInstance } from 'fastify';
import { HttpError } from '../../lib/errors.js';
import { RecommendationConsumerService } from '../../modules/recommendations/recommendation-consumer.service.js';
import { RecommendationOutputService } from '../../modules/recommendations/recommendation-output.service.js';

export async function registerRecommendationOutputRoutes(app: FastifyInstance): Promise<void> {
  const consumerService = new RecommendationConsumerService();
  const outputService = new RecommendationOutputService();

  app.get('/v1/recommendation-consumers', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    return {
      items: await consumerService.listForUser(actor.appUserId),
    };
  });

  app.post('/v1/recommendation-consumers', async (request, reply) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const displayName = String(body.displayName ?? '').trim();
    if (!displayName) {
      throw new HttpError(400, 'displayName is required.');
    }
    const consumer = await consumerService.ensureForUser(actor.appUserId, {
      displayName,
      sourceKey: typeof body.sourceKey === 'string' ? body.sourceKey : null,
    });
    reply.code(201);
    return { consumer };
  });

  app.delete('/v1/recommendation-consumers/:consumerId', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    const params = request.params as { consumerId: string };
    await consumerService.revokeForUser(actor.appUserId, params.consumerId);
    return { revoked: true };
  });

  app.get('/v1/profiles/:profileId/taste-profiles', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    app.requireScopes(request, ['taste-profile:read']);
    const params = request.params as { profileId: string };
    return {
      items: await outputService.listTasteProfilesForUser(actor.appUserId, params.profileId),
    };
  });

  app.get('/v1/profiles/:profileId/taste-profile', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    app.requireScopes(request, ['taste-profile:read']);
    const params = request.params as { profileId: string };
    const query = (request.query ?? {}) as Record<string, unknown>;
    const sourceKey = parseSourceKey(query.sourceKey);
    return {
      tasteProfile: await outputService.getTasteProfileForUser(actor.appUserId, params.profileId, sourceKey),
    };
  });

  app.put('/v1/profiles/:profileId/taste-profile', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    app.requireScopes(request, ['taste-profile:write']);
    const params = request.params as { profileId: string };
    return {
      tasteProfile: await outputService.upsertTasteProfileForUser(actor.appUserId, params.profileId, parseTasteProfileInput(request.body)),
    };
  });

  app.get('/v1/profiles/:profileId/recommendations', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    app.requireScopes(request, ['recommendations:read']);
    const params = request.params as { profileId: string };
    const query = (request.query ?? {}) as Record<string, unknown>;
    const activeOnly = query.active === true || query.active === 'true';
    if (activeOnly) {
      return {
        recommendations: await outputService.getActiveRecommendationForUser(
          actor.appUserId,
          params.profileId,
          parseAlgorithmVersion(query.algorithmVersion),
        ),
      };
    }

    const sourceKey = parseSourceKey(query.sourceKey);
    return {
      recommendations: await outputService.getRecommendationsForUser(
        actor.appUserId,
        params.profileId,
        sourceKey,
        parseAlgorithmVersion(query.algorithmVersion),
      ),
    };
  });

  app.put('/v1/profiles/:profileId/recommendations', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    app.requireScopes(request, ['recommendations:write']);
    const params = request.params as { profileId: string };
    return {
      recommendations: await outputService.upsertRecommendationsForUser(actor.appUserId, params.profileId, parseRecommendationSnapshotInput(request.body)),
    };
  });

  app.get('/v1/profiles/:profileId/recommender-source', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    const params = request.params as { profileId: string };
    return {
      activeSourceKey: await outputService.getActiveSourceKeyForUser(actor.appUserId, params.profileId),
    };
  });

  app.put('/v1/profiles/:profileId/recommender-source', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    const params = request.params as { profileId: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const sourceKey = parseSourceKey(body.sourceKey);
    return {
      activeSourceKey: await outputService.setActiveSourceKeyForUser(actor.appUserId, params.profileId, sourceKey),
    };
  });

  app.get('/internal/v1/profiles/:profileId/taste-profile', async (request) => {
    await app.requireServiceAuth(request);
    const params = request.params as { profileId: string };
    const query = (request.query ?? {}) as Record<string, unknown>;
    return {
      tasteProfile: await outputService.getTasteProfileForService(params.profileId, parseSourceKey(query.sourceKey)),
    };
  });

  app.put('/internal/v1/profiles/:profileId/taste-profile', async (request) => {
    await app.requireServiceAuth(request);
    const params = request.params as { profileId: string };
    return {
      tasteProfile: await outputService.upsertTasteProfileForService(params.profileId, parseTasteProfileInput(request.body)),
    };
  });

  app.get('/internal/v1/profiles/:profileId/recommendations', async (request) => {
    await app.requireServiceAuth(request);
    const params = request.params as { profileId: string };
    const query = (request.query ?? {}) as Record<string, unknown>;
    return {
      recommendations: await outputService.getRecommendationsForService(
        params.profileId,
        parseSourceKey(query.sourceKey),
        parseAlgorithmVersion(query.algorithmVersion),
      ),
    };
  });

  app.put('/internal/v1/profiles/:profileId/recommendations', async (request) => {
    await app.requireServiceAuth(request);
    const params = request.params as { profileId: string };
    return {
      recommendations: await outputService.upsertRecommendationsForService(params.profileId, parseRecommendationSnapshotInput(request.body)),
    };
  });
}

function parseTasteProfileInput(body: unknown) {
  const value = asRecord(body);
  return {
    sourceKey: parseSourceKey(value.sourceKey),
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
  const algorithmVersion = typeof value.algorithmVersion === 'string' && value.algorithmVersion.trim()
    ? value.algorithmVersion.trim()
    : null;
  if (!algorithmVersion) {
    throw new HttpError(400, 'algorithmVersion is required.');
  }

  const historyGeneration = Number(value.historyGeneration);
  if (!Number.isInteger(historyGeneration) || historyGeneration < 0) {
    throw new HttpError(400, 'historyGeneration must be a non-negative integer.');
  }

  const generatedAt = typeof value.generatedAt === 'string' && value.generatedAt.trim() ? value.generatedAt : null;
  if (!generatedAt) {
    throw new HttpError(400, 'generatedAt is required.');
  }

  return {
    sourceKey: parseSourceKey(value.sourceKey),
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

function parseSourceKey(value: unknown): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  throw new HttpError(400, 'sourceKey is required.');
}

function parseAlgorithmVersion(value: unknown): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return 'default';
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
