import type { FastifyInstance } from 'fastify';
import { HttpError } from '../../lib/errors.js';
import type { AppAuthorizationService } from '../../modules/apps/app-authorization.service.js';
import type { AppRateLimitService } from '../../modules/apps/app-rate-limit.service.js';
import { RecommendationAiPlanService } from '../../modules/recommendations/recommendation-ai-plan.service.js';
import type { RecommendationAiPlanRequest } from '../../modules/recommendations/recommendation-ai-plan.types.js';
import { validateAiPlanRequest, validatePathBodyMatch } from '../../modules/recommendations/recommendation-ai-plan.validation.js';

export interface InternalRecommendationsRoutesDeps {
  appAuthorizationService: AppAuthorizationService;
  appRateLimitService: AppRateLimitService;
  recommendationAiPlanService?: RecommendationAiPlanService;
}

export async function registerInternalRecommendationsRoutes(
  app: FastifyInstance,
  deps: InternalRecommendationsRoutesDeps,
): Promise<void> {
  const recommendationAiPlanService = deps.recommendationAiPlanService ?? new RecommendationAiPlanService();

  app.post('/internal/recommendations/v1/accounts/:accountId/profiles/:profileId/ai-plan', async (request, reply) => {
    const principal = await app.requireRecommenderAuth(request);
    deps.appAuthorizationService.requireScope({ principal, scope: 'recommendations:ai-plan:generate' });
    await deps.appRateLimitService.checkAndConsume({ principal, routeGroup: 'recommendations.ai-plan' });

    const params = request.params as { accountId: string; profileId: string };
    if (!params.accountId || !params.profileId) {
      throw new HttpError(400, 'accountId and profileId are required', { code: 'INVALID_AI_PLAN_REQUEST' });
    }

    validateAiPlanRequest(request.body);
    const body = request.body as RecommendationAiPlanRequest;
    validatePathBodyMatch(params.accountId, params.profileId, body);

    const response = await recommendationAiPlanService.generatePlan(body);
    return reply.code(200).send(response);
  });
}
