import { withTransaction } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { UserRepository } from './user.repo.js';
import { ExternalAuthAdminService } from '../auth/external-auth-admin.service.js';

export type AccountLookupResult = {
  accountId: string;
  email: string | null;
};

export class AccountLookupService {
  constructor(
    private readonly userRepository = new UserRepository(),
    private readonly externalAuthAdminService?: ExternalAuthAdminService,
  ) {}

  async getById(accountId: string): Promise<AccountLookupResult> {
    return withTransaction(async (client) => {
      const user = await this.userRepository.findById(client, accountId);
      if (!user) {
        throw new HttpError(404, 'Account not found.');
      }

      return {
        accountId: user.id,
        email: user.email,
      } satisfies AccountLookupResult;
    });
  }

  async getByEmail(email: string): Promise<AccountLookupResult> {
    const normalizedEmail = normalizeEmail(email);
    return withTransaction(async (client) => {
      const users = await this.userRepository.listByEmail(client, normalizedEmail);
      if (users.length === 0) {
        const synced = await this.trySyncFromAuthAdmin(normalizedEmail, client);
        if (synced) {
          return synced;
        }
        throw new HttpError(404, 'Account not found for email.');
      }
      if (users.length > 1) {
        throw new HttpError(409, 'Multiple accounts found for email.');
      }

      const user = users[0]!;
      return {
        accountId: user.id,
        email: user.email,
      } satisfies AccountLookupResult;
    });
  }

  private async trySyncFromAuthAdmin(
    email: string,
    client: import('../../lib/db.js').DbClient,
  ): Promise<AccountLookupResult | null> {
    if (!this.externalAuthAdminService?.isConfigured()) {
      return null;
    }

    const authUser = await this.externalAuthAdminService.findUserByEmail(email);
    if (!authUser || !authUser.id) {
      return null;
    }

    const synced = await this.userRepository.upsertFromAuthSubject(client, {
      authSubject: authUser.id,
      email: authUser.email,
    });

    return {
      accountId: synced.id,
      email: synced.email,
    };
  }
}

function normalizeEmail(value: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new HttpError(400, 'email is required.');
  }
  return normalized;
}
