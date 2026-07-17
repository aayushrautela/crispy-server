import type { FastifyInstance } from 'fastify';
import { aiInsightsRouteSchema, aiSearchRouteSchema } from '../contracts/ai.js';
import { AiInsightsService } from '../../modules/ai/ai-insights.service.js';
import { AiSearchService } from '../../modules/ai/ai-search.service.js';
import { success } from '../response.js';
import { extractProfileUnlockToken, requireProfileUnlock } from '../plugins/profile-unlock-guard.js';

export interface AiRoutesDeps {
  profilePinService?: {
    hasPin(profileId: string): Promise<boolean>;
  };
}

export async function registerAiRoutes(
  app: FastifyInstance,
  deps: AiRoutesDeps = {}
): Promise<void> {
  const aiSearchService = new AiSearchService();
  const aiInsightsService = new AiInsightsService();
  const { profilePinService } = deps;

  async function assertProfileUnlocked(request: import('fastify').FastifyRequest, profileId: string) {
    if (!profilePinService) return;
    const hasPin = await profilePinService.hasPin(profileId);
    if (!hasPin) return;
    await requireProfileUnlock(request, profileId);
  }

  app.post('/v1/profiles/:profileId/ai/search', { schema: aiSearchRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    const params = request.params as { profileId: string };
    await assertProfileUnlocked(request, params.profileId);
    const body = (request.body ?? {}) as Record<string, unknown>;
    return success(await aiSearchService.search(actor.appUserId, {
      query: typeof body.query === 'string' ? body.query : '',
      profileId: params.profileId,
      locale: typeof body.locale === 'string' ? body.locale : null,
    }), request);
  });

  app.post('/v1/profiles/:profileId/ai/insights', { schema: aiInsightsRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    const params = request.params as { profileId: string };
    await assertProfileUnlocked(request, params.profileId);
    const body = (request.body ?? {}) as Record<string, unknown>;
    return success(await aiInsightsService.getInsights(actor.appUserId, {
      itemId: typeof body.itemId === 'string' ? body.itemId : '',
      profileId: params.profileId,
      locale: typeof body.locale === 'string' ? body.locale : null,
    }), request);
  });
}
