import { env } from '../../config/env.js';
import { getByokOpenRouterProvider, getServerAiProvider } from '../../config/app-config.js';
import { HttpError } from '../../lib/errors.js';
import { AccountSettingsService } from '../users/account-settings.service.js';
import type { PricingTier } from '../users/account-settings.service.js';
import type { AiFeatureId, ResolvedAiRequest, ServerAiTier } from './ai.types.js';

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
  serverTier?: ServerAiTier;
};

const TIER_POLICIES: Record<PricingTier, TierCredentialPolicy> = {
  free: { allowUserKey: false, allowServerKey: false },
  lite: { allowUserKey: true, allowServerKey: false },
  pro: { allowUserKey: false, allowServerKey: true, serverTier: 'pro' },
  ultra: { allowUserKey: false, allowServerKey: true, serverTier: 'ultra' },
};

export class AiCredentialResolver {
  constructor(
    private readonly accountSettingsService = new AccountSettingsService(),
    private readonly serverApiKey: string = env.aiServerApiKey,
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

    const tier = await this.accountSettingsService.getPricingTierForUser(userId);
    const policy = TIER_POLICIES[tier];

    if (!policy.allowUserKey && !policy.allowServerKey) {
      throw new HttpError(
        412,
        `AI ${task} is not available on the ${tier} tier. Upgrade your account to use AI features.`,
      );
    }

    if (policy.allowUserKey && !policy.allowServerKey) {
      // Lite tier: BYOK OpenRouter only.
      const byokProvider = getByokOpenRouterProvider();
      const userKey = await this.getUserApiKey(userId);
      if (!userKey) {
        throw new HttpError(
          412,
          `AI ${task} requires an API key. Add your ${byokProvider.label} API key in Account Settings.`,
        );
      }

      const model = byokProvider.models[taskConfig.feature];

      return {
        feature: taskConfig.feature,
        providerId: byokProvider.id,
        provider: {
          id: byokProvider.id,
          label: byokProvider.label,
          endpointUrl: byokProvider.endpointUrl,
          httpReferer: env.appPublicUrl,
          title: env.appDisplayName,
        },
        model,
        apiKey: userKey,
        credentialSource: 'user',
      };
    }

    if (policy.allowServerKey && !policy.allowUserKey) {
      // Pro/Ultra tier: server-funded AI.
      const serverKey = this.getServerApiKey(policy.serverTier!, taskConfig.feature);
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

  private async getUserApiKey(userId: string): Promise<string | null> {
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

  private getServerApiKey(tier: ServerAiTier, feature: AiFeatureId): ResolvedAiRequest | null {
    if (!this.serverApiKey) {
      return null;
    }

    const serverProvider = getServerAiProvider();
    const model = serverProvider.models[tier][feature];

    return {
      feature,
      providerId: serverProvider.id,
      provider: {
        id: serverProvider.id,
        label: serverProvider.label,
        endpointUrl: serverProvider.endpointUrl,
        httpReferer: env.appPublicUrl,
        title: env.appDisplayName,
      },
      model,
      apiKey: this.serverApiKey,
      credentialSource: 'server',
    };
  }
}
