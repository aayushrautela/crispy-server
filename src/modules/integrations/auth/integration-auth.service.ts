import { withTransaction } from '../../../lib/db.js';
import { nowIso } from '../../../lib/time.js';
import { AccountApiKeyRepository } from '../api-keys/account-api-key.repo.js';
import {
  parseAccountApiKeyToken,
  verifyAccountApiKeySecret,
} from '../api-keys/account-api-key-token.js';
import { RecommendationSourceRepository } from '../recommendation-source.repo.js';
import type { AuthenticatedIntegrationPrincipal } from './integration-auth.types.js';

export class IntegrationAuthService {
  constructor(
    private readonly apiKeyRepo = new AccountApiKeyRepository(),
    private readonly sourceRepo = new RecommendationSourceRepository(),
  ) {}

  async authenticateApiKeyToken(token: string): Promise<AuthenticatedIntegrationPrincipal | null> {
    const parsed = parseAccountApiKeyToken(token);
    if (!parsed) {
      return null;
    }

    return withTransaction(async (client) => {
      const key = await this.apiKeyRepo.findActiveByPrefix(client, parsed.prefix);
      if (!key) {
        return null;
      }

      if (!verifyAccountApiKeySecret(parsed.secret, key.keyHash)) {
        return null;
      }

      await this.sourceRepo.ensureExternalSourceForApiKey(client, {
        accountId: key.accountId,
        apiKeyId: key.id,
      });

      if (shouldUpdateLastUsed(key.lastUsedAt)) {
        await this.apiKeyRepo.markLastUsed(client, key.id, nowIso());
      }

      return {
        kind: 'integration_api_key',
        accountId: key.accountId,
        apiKeyId: key.id,
        keyPrefix: key.keyPrefix,
      };
    });
  }
}

function shouldUpdateLastUsed(lastUsedAt: string | null): boolean {
  if (!lastUsedAt) {
    return true;
  }

  const lastUsedMs = new Date(lastUsedAt).getTime();
  if (Number.isNaN(lastUsedMs)) {
    return true;
  }

  return Date.now() - lastUsedMs > 5 * 60 * 1000;
}
