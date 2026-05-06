import { HttpError } from '../../lib/errors.js';
import type { AiExecutionResult } from '../ai/ai.types.js';
import type {
  RecommendationAiPlanRequest,
  RecommendationAiPlanResponse,
  RecommendationAiPlanItem,
} from './recommendation-ai-plan.types.js';
import { buildRecommendationAiPlanPrompt } from './recommendation-ai-plan.prompt.js';
import { validateAiPlanOutput } from './recommendation-ai-plan.output-schema.js';

type RecommendationAiPlanExecutor = {
  generateJsonForUser(args: {
    userId: string;
    feature: 'recommendations';
    systemPrompt?: string;
    userPrompt: string;
  }): Promise<AiExecutionResult>;
};

export class RecommendationAiPlanService {
  constructor(private readonly aiExecutor?: RecommendationAiPlanExecutor) {}

  async generatePlan(request: RecommendationAiPlanRequest): Promise<RecommendationAiPlanResponse> {
    const startTime = Date.now();

    const { systemPrompt, userPrompt } = buildRecommendationAiPlanPrompt(request);

    const executor = await this.getExecutor();
    let aiResult;
    try {
      aiResult = await executor.generateJsonForUser({
        userId: request.profile.accountId,
        feature: 'recommendations',
        systemPrompt,
        userPrompt,
      });
    } catch (error) {
      throw this.mapAiExecutorError(error, request.requestId);
    }

    const validatedOutput = validateAiPlanOutput(
      aiResult.payload,
      request.candidatePool,
      request.constraints.maxItems,
    );

    const candidateMap = new Map(request.candidatePool.map((c) => [c.mediaKey, c]));

    const items: RecommendationAiPlanItem[] = validatedOutput.items.map((item, index) => {
      const candidate = candidateMap.get(item.mediaKey)!;
      return {
        rank: index + 1,
        mediaKey: item.mediaKey,
        mediaType: candidate.mediaType,
        provider: candidate.provider,
        providerId: candidate.providerId,
        title: candidate.title,
        score: item.score,
        confidence: item.confidence,
        reason: item.reason,
        reasonCodes: item.reasonCodes,
      };
    });

    const latencyMs = Date.now() - startTime;
    
    const { buildAiInsightsGenerationVersion } = await import('../ai/ai-provider-resolver.js');
    const aiPlanVersion = buildAiInsightsGenerationVersion(aiResult.request);

    return {
      schemaVersion: 1,
      requestId: request.requestId,
      runId: request.runId,
      listKey: request.listKey,
      generatedAt: new Date().toISOString(),
      plan: {
        summary: validatedOutput.summary,
        items,
      },
      diagnostics: {
        aiPlanVersion,
        latencyMs,
      },
    };
  }

  private async getExecutor(): Promise<RecommendationAiPlanExecutor> {
    if (this.aiExecutor) {
      return this.aiExecutor;
    }
    const { AiRequestExecutor } = await import('../ai/ai-request-executor.js');
    return new AiRequestExecutor();
  }

  private mapAiExecutorError(error: unknown, requestId: string): HttpError {
    if (error instanceof HttpError) {
      if (error.statusCode === 504) {
        return new HttpError(504, 'AI plan generation timed out', {
          code: 'AI_PLAN_TIMEOUT',
          requestId,
          retryable: true,
        });
      }

      if (error.statusCode === 429) {
        return new HttpError(429, 'AI plan rate limited', {
          code: 'AI_PLAN_RATE_LIMITED',
          requestId,
          retryable: true,
        });
      }

      if (error.statusCode === 502 || error.statusCode === 503) {
        return new HttpError(502, 'AI provider unavailable', {
          code: 'AI_PLAN_PROVIDER_UNAVAILABLE',
          requestId,
          retryable: true,
        });
      }

      if (error.details && typeof error.details === 'object') {
        const details = error.details as { code?: string };
        if (details.code?.startsWith('AI_PLAN_')) {
          return error;
        }
      }
    }

    return new HttpError(500, 'AI plan generation failed', {
      code: 'AI_PLAN_INTERNAL_ERROR',
      requestId,
      retryable: true,
      originalError: error instanceof Error ? error.message : String(error),
    });
  }
}
