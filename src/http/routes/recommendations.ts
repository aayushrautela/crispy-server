import type { FastifyInstance } from 'fastify';
import { HttpError } from '../../lib/errors.js';
import type { AuthScope } from '../../modules/auth/auth.types.js';
import { PersonalAccessTokenService } from '../../modules/auth/personal-access-token.service.js';
import {
  RecommendationAccessService,
  type RecommendationSnapshotInput,
  type RecommendationTasteProfileInput,
} from '../../modules/recommendations/recommendation-access.service.js';

export async function registerRecommendationRoutes(app: FastifyInstance): Promise<void> {
  const recommendationAccessService = new RecommendationAccessService();
  const patService = new PersonalAccessTokenService();

  app.get('/v1/auth/personal-access-tokens', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    return {
      items: await patService.listForUser(actor.appUserId),
    };
  });

  app.post('/v1/auth/personal-access-tokens', async (request, reply) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const created = await patService.createForUser(actor.appUserId, {
      name: String(body.name ?? '').trim(),
      scopes: parseScopes(body.scopes),
      expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : null,
    });
    reply.code(201);
    return created;
  });

  app.delete('/v1/auth/personal-access-tokens/:tokenId', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    const params = request.params as { tokenId: string };
    return {
      token: await patService.revokeForUser(actor.appUserId, params.tokenId),
    };
  });

  app.get('/v1/profiles/:profileId/tracked-series', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    app.requireScopes(request, ['watch:read']);
    const params = request.params as { profileId: string };
    const limit = clampLimit(parseOptionalNumber((request.query as Record<string, unknown>).limit) ?? 25, 1, 100);
    return {
      items: await recommendationAccessService.getTrackedSeriesForUser(actor.appUserId, params.profileId, limit),
    };
  });

  app.get('/v1/profiles/:profileId/taste-profile', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    app.requireScopes(request, ['taste-profile:read']);
    const params = request.params as { profileId: string };
    return {
      tasteProfile: await recommendationAccessService.getTasteProfileForUser(actor.appUserId, params.profileId),
    };
  });

  app.put('/v1/profiles/:profileId/taste-profile', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    app.requireScopes(request, ['taste-profile:write']);
    const params = request.params as { profileId: string };
    return {
      tasteProfile: await recommendationAccessService.upsertTasteProfileForUser(
        actor.appUserId,
        params.profileId,
        parseTasteProfileInput(request.body),
      ),
    };
  });

  app.get('/v1/profiles/:profileId/recommendations', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    app.requireScopes(request, ['recommendations:read']);
    const params = request.params as { profileId: string };
    const algorithmVersion = parseAlgorithmVersion((request.query as Record<string, unknown>).algorithmVersion);
    return {
      recommendations: await recommendationAccessService.getRecommendationsForUser(
        actor.appUserId,
        params.profileId,
        algorithmVersion,
      ),
    };
  });

  app.put('/v1/profiles/:profileId/recommendations', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    app.requireScopes(request, ['recommendations:write']);
    const params = request.params as { profileId: string };
    return {
      recommendations: await recommendationAccessService.upsertRecommendationsForUser(
        actor.appUserId,
        params.profileId,
        parseRecommendationSnapshotInput(request.body),
      ),
    };
  });

  app.get('/internal/v1/profiles', async (request) => {
    await app.requireServiceAuth(request);
    const query = (request.query ?? {}) as Record<string, unknown>;
    const limit = clampLimit(parseOptionalNumber(query.limit) ?? 100, 1, 250);
    const offset = Math.max(parseOptionalNumber(query.offset) ?? 0, 0);
    return recommendationAccessService.listAllProfiles(limit, offset);
  });

  app.get('/internal/v1/profiles/:profileId/watch-history', async (request) => {
    await app.requireServiceAuth(request);
    const params = request.params as { profileId: string };
    const limit = clampLimit(parseOptionalNumber((request.query as Record<string, unknown>).limit) ?? 100, 1, 500);
    return {
      items: await recommendationAccessService.getWatchHistoryForService(params.profileId, limit),
    };
  });

  app.get('/internal/v1/profiles/:profileId/continue-watching', async (request) => {
    await app.requireServiceAuth(request);
    const params = request.params as { profileId: string };
    const limit = clampLimit(parseOptionalNumber((request.query as Record<string, unknown>).limit) ?? 50, 1, 250);
    return {
      items: await recommendationAccessService.getContinueWatchingForService(params.profileId, limit),
    };
  });

  app.get('/internal/v1/profiles/:profileId/watchlist', async (request) => {
    await app.requireServiceAuth(request);
    const params = request.params as { profileId: string };
    const limit = clampLimit(parseOptionalNumber((request.query as Record<string, unknown>).limit) ?? 100, 1, 500);
    return {
      items: await recommendationAccessService.getWatchlistForService(params.profileId, limit),
    };
  });

  app.get('/internal/v1/profiles/:profileId/ratings', async (request) => {
    await app.requireServiceAuth(request);
    const params = request.params as { profileId: string };
    const limit = clampLimit(parseOptionalNumber((request.query as Record<string, unknown>).limit) ?? 100, 1, 500);
    return {
      items: await recommendationAccessService.getRatingsForService(params.profileId, limit),
    };
  });

  app.get('/internal/v1/profiles/:profileId/tracked-series', async (request) => {
    await app.requireServiceAuth(request);
    const params = request.params as { profileId: string };
    const limit = clampLimit(parseOptionalNumber((request.query as Record<string, unknown>).limit) ?? 25, 1, 100);
    return {
      items: await recommendationAccessService.getTrackedSeriesForService(params.profileId, limit),
    };
  });

  app.get('/internal/v1/profiles/:profileId/taste-profile', async (request) => {
    await app.requireServiceAuth(request);
    const params = request.params as { profileId: string };
    return {
      tasteProfile: await recommendationAccessService.getTasteProfileForService(params.profileId),
    };
  });

  app.put('/internal/v1/profiles/:profileId/taste-profile', async (request) => {
    await app.requireServiceAuth(request);
    const params = request.params as { profileId: string };
    return {
      tasteProfile: await recommendationAccessService.upsertTasteProfileForService(
        params.profileId,
        parseTasteProfileInput(request.body),
      ),
    };
  });

  app.get('/internal/v1/profiles/:profileId/recommendations', async (request) => {
    await app.requireServiceAuth(request);
    const params = request.params as { profileId: string };
    const algorithmVersion = parseAlgorithmVersion((request.query as Record<string, unknown>).algorithmVersion);
    return {
      recommendations: await recommendationAccessService.getRecommendationsForService(params.profileId, algorithmVersion),
    };
  });

  app.put('/internal/v1/profiles/:profileId/recommendations', async (request) => {
    await app.requireServiceAuth(request);
    const params = request.params as { profileId: string };
    return {
      recommendations: await recommendationAccessService.upsertRecommendationsForService(
        params.profileId,
        parseRecommendationSnapshotInput(request.body),
      ),
    };
  });

  app.get('/internal/v1/profiles/:profileId/outbox-events', async (request) => {
    await app.requireServiceAuth(request);
    const params = request.params as { profileId: string };
    const query = (request.query ?? {}) as Record<string, unknown>;
    const limit = clampLimit(parseOptionalNumber(query.limit) ?? 100, 1, 500);
    const afterId = parseOptionalNumber(query.afterId);
    return {
      items: await recommendationAccessService.getOutboxEvents(params.profileId, afterId, limit),
    };
  });

  app.post('/internal/v1/profiles/:profileId/outbox-events/mark-delivered', async (request) => {
    await app.requireServiceAuth(request);
    const params = request.params as { profileId: string };
    const body = (request.body ?? {}) as { ids?: unknown };
    const ids = Array.isArray(body.ids)
      ? body.ids.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)
      : [];
    return recommendationAccessService.markOutboxDelivered(params.profileId, ids);
  });
}

function parseTasteProfileInput(body: unknown): RecommendationTasteProfileInput {
  const value = asRecord(body);
  return {
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

function parseRecommendationSnapshotInput(body: unknown): RecommendationSnapshotInput {
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

function parseAlgorithmVersion(value: unknown): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return 'default';
}

function parseScopes(value: unknown) {
  return Array.isArray(value) ? value.filter(isAuthScope) : undefined;
}

function parseOptionalNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function clampLimit(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function isAuthScope(value: unknown): value is AuthScope {
  return value === 'profiles:read'
    || value === 'watch:read'
    || value === 'taste-profile:read'
    || value === 'taste-profile:write'
    || value === 'recommendations:read'
    || value === 'recommendations:write';
}
