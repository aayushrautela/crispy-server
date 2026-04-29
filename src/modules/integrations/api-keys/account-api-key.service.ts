import { withTransaction } from '../../../lib/db.js';
import { HttpError } from '../../../lib/errors.js';
import { normalizeOptionalIsoString, nowIso } from '../../../lib/time.js';
import { IntegrationAuditService } from '../auth/integration-audit.service.js';
import {
  generateAccountApiKeyToken,
  hashAccountApiKeySecret,
} from './account-api-key-token.js';
import { AccountApiKeyRepository } from './account-api-key.repo.js';
import type {
  AccountApiKeyRecord,
  CreateAccountApiKeyInput,
  CreateAccountApiKeyResult,
  RevokeAccountApiKeyInput,
  RotateAccountApiKeyInput,
} from './account-api-key.types.js';

export class AccountApiKeyService {
  constructor(
    private readonly repo = new AccountApiKeyRepository(),
    private readonly auditService = new IntegrationAuditService(),
  ) {}

  async create(input: CreateAccountApiKeyInput): Promise<CreateAccountApiKeyResult> {
    const name = input.name.trim();
    if (!name) {
      throw new HttpError(400, 'API key name is required.');
    }

    const token = generateAccountApiKeyToken();
    const keyHash = hashAccountApiKeySecret(token.secret);
    const expiresAt = normalizeOptionalIsoString(input.expiresAt ?? null, 'expiresAt');

    const created = await withTransaction(async (client) => {
      const key = await this.repo.create(client, {
        accountId: input.accountId,
        name,
        keyPrefix: token.prefix,
        keyHash,
        createdByUserId: input.createdByUserId,
        expiresAt,
      });

      await this.auditService.record(client, {
        accountId: input.accountId,
        apiKeyId: key.id,
        actorType: 'user',
        action: 'api_key.created',
        resourceType: 'account_api_key',
        resourceId: key.id,
      });

      return key;
    });

    return {
      key: created,
      plaintextToken: token.plaintextToken,
    };
  }

  async list(accountId: string): Promise<AccountApiKeyRecord[]> {
    return withTransaction(async (client) => this.repo.listForAccount(client, accountId));
  }

  async revoke(input: RevokeAccountApiKeyInput): Promise<AccountApiKeyRecord> {
    return withTransaction(async (client) => {
      const existing = await this.repo.findByIdForAccount(client, input.accountId, input.keyId);
      if (!existing) {
        throw new HttpError(404, 'API key not found.');
      }

      if (existing.status === 'revoked') {
        return existing;
      }

      const revoked = await this.repo.revoke(client, {
        accountId: input.accountId,
        keyId: input.keyId,
        revokedByUserId: input.revokedByUserId,
        revokedAt: nowIso(),
      });

      await this.auditService.record(client, {
        accountId: input.accountId,
        apiKeyId: revoked.id,
        actorType: 'user',
        action: 'api_key.revoked',
        resourceType: 'account_api_key',
        resourceId: revoked.id,
      });

      return revoked;
    });
  }

  async rotate(input: RotateAccountApiKeyInput): Promise<CreateAccountApiKeyResult> {
    const token = generateAccountApiKeyToken();
    const keyHash = hashAccountApiKeySecret(token.secret);
    const expiresAt = normalizeOptionalIsoString(input.expiresAt ?? null, 'expiresAt');

    const created = await withTransaction(async (client) => {
      const existing = await this.repo.findByIdForAccount(client, input.accountId, input.keyId);
      if (!existing) {
        throw new HttpError(404, 'API key not found.');
      }

      if (existing.status !== 'revoked') {
        await this.repo.revoke(client, {
          accountId: input.accountId,
          keyId: input.keyId,
          revokedByUserId: input.rotatedByUserId,
          revokedAt: nowIso(),
        });
      }

      const key = await this.repo.create(client, {
        accountId: input.accountId,
        name: input.name?.trim() || existing.name,
        keyPrefix: token.prefix,
        keyHash,
        createdByUserId: input.rotatedByUserId,
        expiresAt,
        rotatedFromKeyId: existing.id,
      });

      await this.auditService.record(client, {
        accountId: input.accountId,
        apiKeyId: key.id,
        actorType: 'user',
        action: 'api_key.rotated',
        resourceType: 'account_api_key',
        resourceId: key.id,
        metadata: { rotatedFromKeyId: existing.id },
      });

      return key;
    });

    return {
      key: created,
      plaintextToken: token.plaintextToken,
    };
  }
}
