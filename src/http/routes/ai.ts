import type { FastifyInstance } from 'fastify';
import { AiInsightsService } from '../../modules/ai/ai-insights.service.js';
import { AiSearchService } from '../../modules/ai/ai-search.service.js';

export async function registerAiRoutes(app: FastifyInstance): Promise<void> {
  const aiSearchService = new AiSearchService();
  const aiInsightsService = new AiInsightsService();

  app.post('/v1/ai/search', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    return aiSearchService.search(actor.appUserId, {
      query: typeof body.query === 'string' ? body.query : '',
      profileId: resolveProfileId(request, body),
      filter: typeof body.filter === 'string' ? body.filter : null,
      locale: typeof body.locale === 'string' ? body.locale : null,
    });
  });

  app.post('/v1/ai/insights', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    return aiInsightsService.getInsights(actor.appUserId, {
      tmdbId: typeof body.tmdbId === 'number' ? body.tmdbId : Number(body.tmdbId),
      mediaType: typeof body.mediaType === 'string' ? body.mediaType : '',
      profileId: resolveProfileId(request, body),
      locale: typeof body.locale === 'string' ? body.locale : null,
    });
  });
}

function resolveProfileId(request: import('fastify').FastifyRequest, body: Record<string, unknown>): string {
  if (typeof body.profileId === 'string' && body.profileId.trim()) {
    return body.profileId.trim();
  }

  return request.profileId?.trim() || '';
}
