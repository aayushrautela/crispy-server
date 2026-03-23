import { randomBytes } from 'node:crypto';
import { withTransaction } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { UserRepository } from '../users/user.repo.js';
import type { AuthActor, AuthScope } from './auth.types.js';
import { PAT_DEFAULT_SCOPES, USER_DEFAULT_SCOPES } from './auth.types.js';
import { PersonalAccessTokenRepository, type PersonalAccessTokenRecord } from './personal-access-token.repo.js';
import { hashAccessToken } from './token-hash.js';

export type PersonalAccessTokenView = {
  id: string;
  name: string;
  tokenPreview: string;
  scopes: AuthScope[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export type CreatedPersonalAccessToken = {
  token: PersonalAccessTokenView;
  plaintextToken: string;
};

export class PersonalAccessTokenService {
  constructor(
    private readonly tokenRepository = new PersonalAccessTokenRepository(),
    private readonly userRepository = new UserRepository(),
  ) {}

  async createForUser(userId: string, input: {
    name: string;
    scopes?: AuthScope[];
    expiresAt?: string | null;
  }): Promise<CreatedPersonalAccessToken> {
    const name = input.name.trim();
    if (!name) {
      throw new HttpError(400, 'Token name is required.');
    }

    const scopes = normalizeScopes(input.scopes);
    const rawSecret = randomBytes(24).toString('base64url');
    const plaintextToken = `cp_pat_${rawSecret}`;
    const tokenHash = hashAccessToken(plaintextToken);
    const tokenPreview = plaintextToken.slice(0, 12);

    const created = await withTransaction(async (client) => {
      return this.tokenRepository.create(client, {
        userId,
        name,
        tokenHash,
        tokenPreview,
        scopes,
        expiresAt: input.expiresAt ?? null,
      });
    });

    return {
      token: toTokenView(created),
      plaintextToken,
    };
  }

  async listForUser(userId: string): Promise<PersonalAccessTokenView[]> {
    return withTransaction(async (client) => {
      const rows = await this.tokenRepository.listForUser(client, userId);
      return rows.map((row) => toTokenView(row));
    });
  }

  async revokeForUser(userId: string, tokenId: string): Promise<PersonalAccessTokenView> {
    return withTransaction(async (client) => {
      const revoked = await this.tokenRepository.revoke(client, userId, tokenId);
      if (!revoked) {
        throw new HttpError(404, 'Personal access token not found.');
      }
      return toTokenView(revoked);
    });
  }

  async revokeAllForUser(userId: string): Promise<number> {
    return withTransaction(async (client) => this.tokenRepository.revokeAllForUser(client, userId));
  }

  async authenticate(rawToken: string): Promise<AuthActor | null> {
    const tokenHash = hashAccessToken(rawToken);
    return withTransaction(async (client) => {
      const token = await this.tokenRepository.findActiveByHash(client, tokenHash);
      if (!token) {
        return null;
      }

      const user = await this.userRepository.findById(client, token.userId);
      if (!user) {
        return null;
      }

      await this.tokenRepository.touchLastUsed(client, token.id);

      return {
        type: 'pat',
        appUserId: user.id,
        serviceId: null,
        scopes: token.scopes,
        authSubject: user.authSubject,
        email: user.email,
        tokenId: token.id,
      } satisfies AuthActor;
    });
  }
}

function normalizeScopes(scopes?: AuthScope[]): AuthScope[] {
  const values = scopes?.length ? scopes : PAT_DEFAULT_SCOPES;
  return Array.from(new Set(values.filter(isAuthScope)));
}

function isAuthScope(value: string): value is AuthScope {
  return USER_DEFAULT_SCOPES.includes(value as AuthScope) || value === 'recommendations:write';
}

function toTokenView(record: PersonalAccessTokenRecord): PersonalAccessTokenView {
  return {
    id: record.id,
    name: record.name,
    tokenPreview: record.tokenPreview,
    scopes: record.scopes,
    expiresAt: record.expiresAt,
    lastUsedAt: record.lastUsedAt,
    revokedAt: record.revokedAt,
    createdAt: record.createdAt,
  };
}
