import { HttpError } from '../../lib/errors.js';
import { FeatureEntitlementService } from '../entitlements/feature-entitlement.service.js';
import {
  blockServerProvider,
  clearServerModelFailure,
  clearServerProviderBlock,
  recordServerModelRateLimit,
  recordServerModelTransientFailure,
} from './ai-server-fallback-state.js';
import type { AiExecutionResult, AiFeatureId, AiProviderFailureDetails, ResolvedAiRequest } from './ai.types.js';
import { toResolvedRequestKey } from './ai-provider-resolver.js';
import { OpenAiCompatibleClient } from './openai-compatible.client.js';

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
    let attempts = 0;
    const attemptedRequests = new Set<string>();

    while (attempts < 5) {
      attempts += 1;
      const request = await this.entitlementService.resolveAiRequestForUser(args.userId, args.feature, {
        excludeRequestKeys: attemptedRequests,
      });
      attemptedRequests.add(toResolvedRequestKey(request.credentialSource, request.providerId, request.model, request.apiKey));

      try {
        const payload = await this.client.generateJson({
          provider: request.provider,
          apiKey: request.apiKey,
          model: request.model,
          systemPrompt: args.systemPrompt,
          userPrompt: args.userPrompt,
        });
        this.handleSuccess(request);
        return {
          request,
          payload,
        };
      } catch (error) {
        if (!(error instanceof HttpError) || request.credentialSource !== 'server') {
          throw error;
        }

        if (!this.handleServerFailure(request, error)) {
          throw error;
        }
      }
    }

    throw new HttpError(503, `AI ${args.feature} is temporarily unavailable.`);
  }

  private handleSuccess(request: ResolvedAiRequest): void {
    if (request.credentialSource !== 'server') {
      return;
    }

    clearServerProviderBlock(request.providerId);
    clearServerModelFailure(request.providerId, request.model);
  }

  private handleServerFailure(request: ResolvedAiRequest, error: HttpError): boolean {
    const details = toProviderFailureDetails(error.details);
    const providerStatus = details?.providerStatus;
    const providerCode = details?.providerErrorCode?.toLowerCase() ?? '';
    const message = [error.message, details?.errorMessage, details?.responseBody]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .join(' ')
      .toLowerCase();

    if (providerStatus === 401 || providerStatus === 403 || providerCode === 'insufficient_quota' || message.includes('insufficient_quota')) {
      blockServerProvider(request.providerId);
      return true;
    }

    if (providerStatus === 429) {
      recordServerModelRateLimit(request.providerId, request.model, details?.retryAfterSeconds);
      return true;
    }

    if (details?.failureKind === 'network' || providerStatus === 500 || providerStatus === 502 || providerStatus === 503 || providerStatus === 504) {
      recordServerModelTransientFailure(request.providerId, request.model);
      return true;
    }

    return false;
  }
}

function toProviderFailureDetails(value: unknown): AiProviderFailureDetails | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as AiProviderFailureDetails;
}
