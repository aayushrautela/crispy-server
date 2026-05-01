import { env } from '../../config/env.js';
import { HttpError } from '../../lib/errors.js';
import { AiProviderResolver } from '../ai/ai-provider-resolver.js';
import { AiCredentialResolver } from '../ai/ai-credential-resolver.service.js';
import type { AiTaskId } from '../ai/ai-credential-resolver.service.js';
import type { AiFeatureId, ResolvedAiRequest } from '../ai/ai.types.js';
import { AccountSettingsService } from '../users/account-settings.service.js';

const MDB_NOT_CONFIGURED_MESSAGE = 'MDBList is not configured. Add your MDBList API key or set MDBLIST_API_KEY in your environment.';

export class FeatureEntitlementService {
  constructor(
    private readonly aiProviderResolver = new AiProviderResolver(),
    private readonly aiCredentialResolver = new AiCredentialResolver(),
    private readonly accountSettingsService = new AccountSettingsService(),
    private readonly mdblistApiKey = env.mdblistApiKey,
  ) {}

  async resolveAiRequestForUser(
    userId: string,
    feature: AiFeatureId,
    options?: { excludeRequestKeys?: Set<string> },
  ): Promise<ResolvedAiRequest> {
    return this.aiProviderResolver.resolveForUser(userId, feature, options);
  }

  async resolveAiRequestForTask(
    userId: string,
    task: AiTaskId,
  ): Promise<ResolvedAiRequest> {
    return this.aiCredentialResolver.resolveForTask(userId, task);
  }

  async getMetadataClientSettingsForUser(userId: string): Promise<{ hasMdbListAccess: boolean }> {
    return {
      hasMdbListAccess: await this.hasMetadataEnrichmentAccessForUser(userId),
    };
  }

  async hasMetadataEnrichmentAccessForUser(userId: string): Promise<boolean> {
    return (await this.resolveMdbListApiKeyForUser(userId)) !== null;
  }

  async assertMetadataEnrichmentAccessForUser(userId: string): Promise<void> {
    if (!(await this.hasMetadataEnrichmentAccessForUser(userId))) {
      throw new HttpError(412, MDB_NOT_CONFIGURED_MESSAGE);
    }
  }

  async resolveMdbListApiKeyForUser(userId: string): Promise<string | null> {
    try {
      const secret = await this.accountSettingsService.getMdbListApiKeyForUser(userId);
      return secret.value;
    } catch (error) {
      if (!(error instanceof HttpError) || error.statusCode !== 404) {
        throw error;
      }
    }

    return this.isServerMdbListKeyAvailable() ? this.mdblistApiKey.trim() : null;
  }

  private isServerMdbListKeyAvailable(): boolean {
    return typeof this.mdblistApiKey === 'string' && this.mdblistApiKey.trim().length > 0;
  }
}
