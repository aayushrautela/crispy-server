import { env } from '../../config/env.js';
import { HttpError } from '../../lib/errors.js';
import { AiProviderResolver } from '../ai/ai-provider-resolver.js';
import type { AiFeatureId, ResolvedAiRequest } from '../ai/ai.types.js';

const MDB_NOT_CONFIGURED_MESSAGE = 'MDBList is not configured. Set MDBLIST_API_KEY in your environment.';

export class FeatureEntitlementService {
  constructor(
    private readonly aiProviderResolver = new AiProviderResolver(),
    private readonly mdblistApiKey = env.mdblistApiKey,
  ) {}

  async resolveAiRequestForUser(
    userId: string,
    feature: AiFeatureId,
    options?: { excludeRequestKeys?: Set<string> },
  ): Promise<ResolvedAiRequest> {
    return this.aiProviderResolver.resolveForUser(userId, feature, options);
  }

  async getMetadataClientSettingsForUser(_userId: string): Promise<{ hasMdbListAccess: boolean }> {
    return {
      hasMdbListAccess: this.isMetadataEnrichmentAvailable(),
    };
  }

  async hasMetadataEnrichmentAccessForUser(_userId: string): Promise<boolean> {
    return this.isMetadataEnrichmentAvailable();
  }

  async assertMetadataEnrichmentAccessForUser(userId: string): Promise<void> {
    if (!(await this.hasMetadataEnrichmentAccessForUser(userId))) {
      throw new HttpError(412, MDB_NOT_CONFIGURED_MESSAGE);
    }
  }

  private isMetadataEnrichmentAvailable(): boolean {
    return typeof this.mdblistApiKey === 'string' && this.mdblistApiKey.trim().length > 0;
  }
}
