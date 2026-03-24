import type { FastifyInstance } from 'fastify';
import { RecommendationDataService } from '../../modules/recommendations/recommendation-data.service.js';

export async function registerRecommendationDataRoutes(app: FastifyInstance): Promise<void> {
  const recommendationDataService = new RecommendationDataService();

  app.get('/v1/profiles/:profileId/tracked-series', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    app.requireScopes(request, ['watch:read']);
    const params = request.params as { profileId: string };
    const limit = clampLimit(parseOptionalNumber((request.query as Record<string, unknown>).limit) ?? 25, 1, 100);
    return {
      items: await recommendationDataService.getTrackedSeriesForUser(actor.appUserId, params.profileId, limit),
    };
  });

  app.get('/internal/v1/profiles', async (request) => {
    await app.requireServiceAuth(request);
    app.requireScopes(request, ['profiles:read']);
    const query = (request.query ?? {}) as Record<string, unknown>;
    const limit = clampLimit(parseOptionalNumber(query.limit) ?? 100, 1, 250);
    const offset = Math.max(parseOptionalNumber(query.offset) ?? 0, 0);
    return recommendationDataService.listAllProfiles(limit, offset);
  });

  app.get('/internal/v1/profiles/:profileId/watch-history', async (request) => {
    await app.requireServiceAuth(request);
    app.requireScopes(request, ['watch:read']);
    const params = request.params as { profileId: string };
    const limit = clampLimit(parseOptionalNumber((request.query as Record<string, unknown>).limit) ?? 100, 1, 500);
    return {
      items: await recommendationDataService.getWatchHistoryForService(params.profileId, limit),
    };
  });

  app.get('/internal/v1/profiles/:profileId/continue-watching', async (request) => {
    await app.requireServiceAuth(request);
    app.requireScopes(request, ['watch:read']);
    const params = request.params as { profileId: string };
    const limit = clampLimit(parseOptionalNumber((request.query as Record<string, unknown>).limit) ?? 50, 1, 250);
    return {
      items: await recommendationDataService.getContinueWatchingForService(params.profileId, limit),
    };
  });

  app.get('/internal/v1/profiles/:profileId/watchlist', async (request) => {
    await app.requireServiceAuth(request);
    app.requireScopes(request, ['watch:read']);
    const params = request.params as { profileId: string };
    const limit = clampLimit(parseOptionalNumber((request.query as Record<string, unknown>).limit) ?? 100, 1, 500);
    return {
      items: await recommendationDataService.getWatchlistForService(params.profileId, limit),
    };
  });

  app.get('/internal/v1/profiles/:profileId/ratings', async (request) => {
    await app.requireServiceAuth(request);
    app.requireScopes(request, ['watch:read']);
    const params = request.params as { profileId: string };
    const limit = clampLimit(parseOptionalNumber((request.query as Record<string, unknown>).limit) ?? 100, 1, 500);
    return {
      items: await recommendationDataService.getRatingsForService(params.profileId, limit),
    };
  });

  app.get('/internal/v1/profiles/:profileId/tracked-series', async (request) => {
    await app.requireServiceAuth(request);
    app.requireScopes(request, ['watch:read']);
    const params = request.params as { profileId: string };
    const limit = clampLimit(parseOptionalNumber((request.query as Record<string, unknown>).limit) ?? 25, 1, 100);
    return {
      items: await recommendationDataService.getTrackedSeriesForService(params.profileId, limit),
    };
  });
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
