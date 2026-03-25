import { withTransaction } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { UserRepository } from './user.repo.js';

export type AccountLookupResult = {
  accountId: string;
  email: string | null;
};

export class AccountLookupService {
  constructor(private readonly userRepository = new UserRepository()) {}

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
        throw new HttpError(404, 'Account not found for email.');
      }
      if (users.length > 1) {
        throw new HttpError(409, 'Multiple accounts found for email.');
      }

      const user = users[0];
      if (!user) {
        throw new HttpError(404, 'Account not found for email.');
      }

      return {
        accountId: user.id,
        email: user.email,
      } satisfies AccountLookupResult;
    });
  }
}

function normalizeEmail(value: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new HttpError(400, 'email is required.');
  }
  return normalized;
}
