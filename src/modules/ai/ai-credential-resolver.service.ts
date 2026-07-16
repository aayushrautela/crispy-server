import { env } from '../../config/env.js';
import { getServerAiProvider } from '../../config/app-config.js';
import { HttpError } from '../../lib/errors.js';
import type { AiFeatureId, ResolvedAiRequest, ServerAiTier } from './ai.types.js';

export type AiTaskId = 'search' | 'insights';

export class AiCredentialResolver {
  constructor(
    private readonly serverApiKey: string = env.aiServerApiKey,
  ) {}

  async resolveForTask(
    _userId: string,
    task: AiTaskId,
  ): Promise<ResolvedAiRequest> {
    const tier: ServerAiTier = 'pro';
    const serverKey = this.getServerApiKey(tier, task);
    if (!serverKey) {
      throw new HttpError(
        503,
        `AI ${task} is temporarily unavailable. Server credentials are not configured.`,
      );
    }
    return serverKey;
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
