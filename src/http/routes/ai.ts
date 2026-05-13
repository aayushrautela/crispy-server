import type { FastifyInstance } from 'fastify';
import { aiInsightsRouteSchema, aiSearchRouteSchema } from '../contracts/ai.js';
import { AiInsightsService } from '../../modules/ai/ai-insights.service.js';
import { AiSearchService } from '../../modules/ai/ai-search.service.js';
import { success } from '../response.js';

export async function registerAiRoutes(app: FastifyInstance): Promise<void> {
  const aiSearchService = new AiSearchService();
  const aiInsightsService = new AiInsightsService();

  app.post('/v1/profiles/:profileId/ai/search', { schema: aiSearchRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const params = request.params as { profileId: string };
    return success(await aiSearchService.search(actor.appUserId, {
      query: typeof body.query === 'string' ? body.query : '',
      profileId: params.profileId,
      locale: typeof body.locale === 'string' ? body.locale : null,
    }), request);
  });

  app.post('/v1/profiles/:profileId/ai/insights', { schema: aiInsightsRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const params = request.params as { profileId: string };
    return success(await aiInsightsService.getInsights(actor.appUserId, {
      mediaKey: typeof body.mediaKey === 'string' ? body.mediaKey : '',
      profileId: params.profileId,
      locale: typeof body.locale === 'string' ? body.locale : null,
    }), request);
  });
}
