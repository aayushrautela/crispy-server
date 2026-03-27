import { appConfig, getAiFeaturePolicy, requireAiProvider } from '../../config/app-config.js';
import { env } from '../../config/env.js';
import { HttpError } from '../../lib/errors.js';
import { AccountSettingsService } from '../users/account-settings.service.js';
import type { AiApiKeyCandidate, AiCredentialSource, AiFeatureId, ResolvedAiRequest } from './ai.types.js';

const sourceCursors = new Map<string, number>();

export class AiProviderResolver {
  constructor(
    private readonly accountSettingsService = new AccountSettingsService(),
    private readonly serverKeys: AiApiKeyCandidate[] = env.aiServerKeys,
  ) {}

  async resolveForUser(userId: string, feature: AiFeatureId): Promise<ResolvedAiRequest> {
    const selectedProviderId = await this.accountSettingsService.getAiProviderIdForUser(userId);
    const lookup = await this.accountSettingsService.listAiApiKeysForLookup(userId);
    const policy = getAiFeaturePolicy(feature);

    let hasConfiguredModel = false;

    for (const step of policy.fallback) {
      const providerId = step.provider.type === 'account'
        ? selectedProviderId
        : step.provider.providerId;
      const provider = requireAiProvider(providerId);
      const model = provider.models[feature].trim();
      if (!model) {
        continue;
      }
      hasConfiguredModel = true;

      const candidates = this.selectCandidates(step.source, provider.id, lookup);
      const candidate = candidates[0];
      if (!candidate) {
        continue;
      }

      return {
        feature,
        providerId: provider.id,
        provider: {
          id: provider.id,
          label: provider.label,
          endpointUrl: provider.endpointUrl,
          httpReferer: provider.httpReferer,
          title: provider.title,
        },
        model,
        apiKey: candidate.apiKey,
        credentialSource: step.source,
      } satisfies ResolvedAiRequest;
    }

    if (!hasConfiguredModel) {
      throw new HttpError(503, `AI ${feature} is not configured.`);
    }

    throw new HttpError(
      412,
      `AI ${feature} is not configured for this account. Add an AI API key in Account Settings or configure server AI credentials.`,
    );
  }

  private selectCandidates(
    source: AiCredentialSource,
    providerId: string,
    lookup: Awaited<ReturnType<AccountSettingsService['listAiApiKeysForLookup']>>,
  ): AiApiKeyCandidate[] {
    if (source === 'user') {
      return lookup.ownKeys.filter((entry) => entry.providerId === providerId);
    }
    if (source === 'server') {
      return rotateCandidates(
        this.serverKeys.filter((entry) => entry.providerId === providerId),
        source,
        providerId,
      );
    }
    return rotateCandidates(
      lookup.pooledKeys.filter((entry) => entry.providerId === providerId),
      source,
      providerId,
    );
  }
}

function rotateCandidates(values: AiApiKeyCandidate[], source: AiCredentialSource, providerId: string): AiApiKeyCandidate[] {
  if (values.length <= 1) {
    return [...values];
  }

  const cursorKey = `${source}:${providerId}`;
  const cursor = sourceCursors.get(cursorKey) ?? 0;
  sourceCursors.set(cursorKey, cursor + 1);

  const startIndex = cursor % values.length;
  return [...values.slice(startIndex), ...values.slice(0, startIndex)];
}

export function buildAiInsightsGenerationVersion(request: Pick<ResolvedAiRequest, 'providerId' | 'model'>): string {
  const provider = request.providerId.replace(/[^a-z0-9._-]+/gi, '-').toLowerCase();
  const model = request.model.replace(/[^a-z0-9._-]+/gi, '-').toLowerCase();
  return `${provider}:${model}`;
}

export function listConfiguredServerAiProviders(): string[] {
  const configured = new Set(env.aiServerKeys.map((entry) => entry.providerId));
  return Object.keys(appConfig.ai.providers).filter((providerId) => configured.has(providerId));
}
