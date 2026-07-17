import { HttpError } from '../../lib/errors.js';
import { FeatureEntitlementService } from '../entitlements/feature-entitlement.service.js';
import type { AiExecutionResult, AiFeatureId } from './ai.types.js';
import { OpenAiCompatibleClient } from './openai-compatible.client.js';

const REQUEST_DEADLINE_MS = 90_000;

export class AiRequestExecutor {
  constructor(
    private readonly entitlementService = new FeatureEntitlementService(),
    private readonly client = new OpenAiCompatibleClient(),
  ) {}

  async generateJsonForUser(args: {
    userId: string;
    feature: AiFeatureId;
    systemPrompt?: string;
    userPrompt: string;
  }): Promise<AiExecutionResult> {
    const request = await this.entitlementService.resolveAiRequestForUser(args.userId, args.feature);

    const signal = AbortSignal.timeout(REQUEST_DEADLINE_MS);
    let payload: Record<string, unknown>;
    try {
      payload = await this.client.generateJson({
        provider: request.provider,
        apiKey: request.apiKey,
        model: request.model,
        systemPrompt: args.systemPrompt,
        userPrompt: args.userPrompt,
        signal,
      });
    } catch (error) {
      if (isAbortTimeoutError(error)) {
        throw new HttpError(504, `AI ${args.feature} timed out after ${REQUEST_DEADLINE_MS / 1000}s.`);
      }
      throw error;
    }

    return {
      request,
      payload,
    };
  }
}

function isAbortTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.name === 'TimeoutError' || error.name === 'AbortError';
}
