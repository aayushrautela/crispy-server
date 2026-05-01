import { env } from '../../config/env.js';
import { appConfig, requireAiProvider } from '../../config/app-config.js';
import { HttpError } from '../../lib/errors.js';
import { AccountSettingsService } from '../users/account-settings.service.js';
import type { PricingTier } from '../users/account-settings.service.js';
import type { AiFeatureId, ResolvedAiRequest, AiApiKeyCandidate } from './ai.types.js';

export type AiTaskId = 'recommendations' | 'search' | 'insights';

type AiTaskConfig = {
  feature: AiFeatureId;
  requiresCredentials: boolean;
};

const AI_TASK_CONFIGS: Record<AiTaskId, AiTaskConfig> = {
  recommendations: { feature: 'recommendations', requiresCredentials: true },
  search: { feature: 'search', requiresCredentials: true },
  insights: { feature: 'insights', requiresCredentials: true },
};

type TierCredentialPolicy = {
  allowUserKey: boolean;
  allowServerKey: boolean;
};

const TIER_POLICIES: Record<PricingTier, TierCredentialPolicy> = {
  free: { allowUserKey: false, allowServerKey: false },
  lite: { allowUserKey: true, allowServerKey: false },
  pro: { allowUserKey: false, allowServerKey: true },
  ultra: { allowUserKey: false, allowServerKey: true },
};

export class AiCredentialResolver {
  constructor(
    private readonly accountSettingsService = new AccountSettingsService(),
    private readonly serverKeys: AiApiKeyCandidate[] = env.aiServerKeys,
  ) {}

  async resolveForTask(
    userId: string,
    task: AiTaskId,
  ): Promise<ResolvedAiRequest> {
    const taskConfig = AI_TASK_CONFIGS[task];
    if (!taskConfig) {
      throw new HttpError(400, `Unknown AI task: ${task}`);
    }

    if (!taskConfig.requiresCredentials) {
      throw new HttpError(503, `AI ${task} is not configured.`);
    }

    const tier = this.accountSettingsService.getPricingTierForUser(userId);
    const policy = TIER_POLICIES[tier];

    if (!policy.allowUserKey && !policy.allowServerKey) {
      throw new HttpError(
        412,
        `AI ${task} is not available on the ${tier} tier. Upgrade your account to use AI features.`,
      );
    }

    const selectedProviderId = await this.accountSettingsService.getAiProviderIdForUser(userId);

    if (policy.allowUserKey && !policy.allowServerKey) {
      // Lite tier: user BYOK only (OpenRouter)
      if (selectedProviderId !== 'openrouter') {
        throw new HttpError(412, `AI ${task} requires OpenRouter BYOK on the ${tier} tier.`);
      }

      const userKey = await this.getUserApiKey(userId, selectedProviderId);
      if (!userKey) {
        throw new HttpError(
          412,
          `AI ${task} requires an API key. Add your OpenRouter API key in Account Settings.`,
        );
      }

      const provider = requireAiProvider(selectedProviderId);
      const model = provider.models[taskConfig.feature];

      return {
        feature: taskConfig.feature,
        providerId: provider.id,
        provider: {
          id: provider.id,
          label: provider.label,
          endpointUrl: provider.endpointUrl,
          httpReferer: env.appPublicUrl,
          title: env.appDisplayName,
        },
        model,
        apiKey: userKey,
        credentialSource: 'user',
      };
    }

    if (policy.allowServerKey && !policy.allowUserKey) {
      // Pro/Ultra tier: server key only
      const serverKey = this.getServerApiKey(selectedProviderId, taskConfig.feature);
      if (!serverKey) {
        throw new HttpError(
          503,
          `AI ${task} is temporarily unavailable. Server credentials are not configured.`,
        );
      }

      return serverKey;
    }

    throw new HttpError(503, `AI ${task} is not configured for this account tier.`);
  }

  private async getUserApiKey(userId: string, providerId: string): Promise<string | null> {
    try {
      const secret = await this.accountSettingsService.getAiApiKeyForUser(userId);
      return secret.value;
    } catch (error) {
      if (error instanceof HttpError && error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  private getServerApiKey(providerId: string, feature: AiFeatureId): ResolvedAiRequest | null {
    const candidates = this.serverKeys.filter((entry) => entry.providerId === providerId);
    if (candidates.length === 0) {
      return null;
    }

    const provider = requireAiProvider(providerId);
    const model = provider.models[feature];
    const candidate = candidates[0];
    if (!candidate) {
      return null;
    }

    return {
      feature,
      providerId: provider.id,
      provider: {
        id: provider.id,
        label: provider.label,
        endpointUrl: provider.endpointUrl,
        httpReferer: env.appPublicUrl,
        title: env.appDisplayName,
      },
      model,
      apiKey: candidate.apiKey,
      credentialSource: 'server',
    };
  }
}
