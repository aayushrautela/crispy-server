import { randomBytes } from 'node:crypto';
import { withDbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import type { AuthActor, AuthScope } from './auth.types.js';
import { PAT_DEFAULT_SCOPES, isPersonalAccessTokenScope } from './auth.types.js';
import { hashAccessToken } from './token-hash.js';
import { PersonalAccessTokenRepository } from './personal-access-token.repo.js';

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
    private readonly repo: PersonalAccessTokenRepository = new PersonalAccessTokenRepository(),
  ) {}

  async createForUser(authSubject: string, input: {
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

    const record = await withDbClient((client) =>
      this.repo.create(client, {
        userId: authSubject,
        name,
        tokenHash,
        tokenPreview,
        scopes,
        expiresAt: input.expiresAt ?? null,
      }),
    );

    return {
      token: mapView(record),
      plaintextToken,
    };
  }

  async listForUser(authSubject: string): Promise<PersonalAccessTokenView[]> {
    const records = await withDbClient((client) => this.repo.listForUser(client, authSubject));
    return records.map(mapView);
  }

  async revokeForUser(authSubject: string, tokenId: string): Promise<PersonalAccessTokenView> {
    const record = await withDbClient((client) => this.repo.revoke(client, authSubject, tokenId));
    if (!record) throw new HttpError(404, 'Personal access token not found.');
    return mapView(record);
  }

  async revokeAllForUser(authSubject: string): Promise<number> {
    return withDbClient((client) => this.repo.revokeAllForUser(client, authSubject));
  }

  async authenticate(rawToken: string): Promise<AuthActor | null> {
    const tokenHash = hashAccessToken(rawToken);

    return withDbClient(async (client) => {
      const token = await this.repo.findActiveByHash(client, tokenHash);
      if (!token) return null;

      const emailResult = await client.query(
        'SELECT email FROM identity.accounts WHERE id = $1::uuid',
        [token.userId],
      );

      await this.repo.touchLastUsed(client, token.id);

      return {
        type: 'pat',
        appUserId: token.userId,
        serviceId: null,
        scopes: token.scopes,
        authSubject: token.userId,
        email: emailResult.rows[0]?.email ?? null,
        tokenId: token.id,
        consumerId: null,
        accessToken: null,
      };
    });
  }
}

function normalizeScopes(scopes?: AuthScope[]): AuthScope[] {
  const values = scopes?.length ? scopes : PAT_DEFAULT_SCOPES;
  return Array.from(new Set(values.filter(isPersonalAccessTokenScope)));
}

function mapView(record: {
  id: string;
  name: string;
  tokenPreview: string;
  scopes: AuthScope[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}): PersonalAccessTokenView {
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
