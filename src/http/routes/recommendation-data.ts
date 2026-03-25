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
      items: await recommendationDataService.getTrackedSeriesForAccount(actor.appUserId, params.profileId, limit),
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
