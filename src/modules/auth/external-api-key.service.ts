import { randomBytes } from 'node:crypto';
import { withDbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import type { AuthActor } from './auth.types.js';
import { hashAccessToken } from './token-hash.js';
import { ExternalApiKeyRepository, type ExternalApiKeyRecord } from './external-api-key.repo.js';

const KEY_PREFIX = 'cp_eak_';

type ExternalApiKeyScope = 'history:read' | 'watchlist:read' | 'ratings:read';

const DEFAULT_SCOPES: ExternalApiKeyScope[] = ['history:read', 'watchlist:read', 'ratings:read'];
const VALID_SCOPES = new Set<string>(DEFAULT_SCOPES);

export type ExternalApiKeyView = {
  id: string;
  name: string;
  keyPreview: string;
  scopes: ExternalApiKeyScope[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export type CreatedExternalApiKey = {
  key: ExternalApiKeyView;
  plaintextKey: string;
};

export class ExternalApiKeyService {
  constructor(
    private readonly repo: ExternalApiKeyRepository = new ExternalApiKeyRepository(),
  ) {}

  async createForUser(accountId: string, input: {
    name: string;
    scopes?: string[];
    expiresAt?: string | null;
  }): Promise<CreatedExternalApiKey> {
    const name = input.name.trim();
    if (!name) {
      throw new HttpError(400, 'Key name is required.');
    }

    const scopes = normalizeScopes(input.scopes);
    const rawSecret = randomBytes(24).toString('base64url');
    const plaintextKey = `${KEY_PREFIX}${rawSecret}`;
    const keyHash = hashAccessToken(plaintextKey);
    const keyPreview = plaintextKey.slice(0, 14);

    const record = await withDbClient((client) =>
      this.repo.create(client, {
        accountId,
        name,
        keyHash,
        keyPreview,
        scopes,
        expiresAt: input.expiresAt ?? null,
      }),
    );

    return {
      key: mapView(record),
      plaintextKey,
    };
  }

  async listForUser(accountId: string): Promise<ExternalApiKeyView[]> {
    const records = await withDbClient((client) => this.repo.listForUser(client, accountId));
    return records.map(mapView);
  }

  async revokeForUser(accountId: string, keyId: string): Promise<ExternalApiKeyView> {
    const record = await withDbClient((client) => this.repo.revoke(client, accountId, keyId));
    if (!record) throw new HttpError(404, 'External API key not found.');
    return mapView(record);
  }

  async authenticate(rawKey: string): Promise<AuthActor | null> {
    if (!rawKey.startsWith(KEY_PREFIX)) return null;

    const keyHash = hashAccessToken(rawKey);
    return withDbClient(async (client) => {
      const key = await this.repo.findActiveByHash(client, keyHash);
      if (!key) return null;

      await this.repo.touchLastUsed(client, key.id);

      const scopes = key.scopes.filter((s): s is ExternalApiKeyScope => VALID_SCOPES.has(s));
      const hasReadScope = scopes.some((s) => s.endsWith(':read'));

      return {
        type: 'pat' as const,
        appUserId: key.accountId,
        serviceId: null,
        scopes: scopes as unknown as never[],
        authSubject: key.accountId,
        email: null,
        tokenId: key.id,
        consumerId: 'external_api',
        accessToken: null,
      };
    });
  }
}

function normalizeScopes(scopes?: string[]): ExternalApiKeyScope[] {
  if (!scopes?.length) return [...DEFAULT_SCOPES];
  return scopes.filter((s): s is ExternalApiKeyScope => VALID_SCOPES.has(s));
}

function mapView(record: ExternalApiKeyRecord): ExternalApiKeyView {
  return {
    id: record.id,
    name: record.name,
    keyPreview: record.keyPreview,
    scopes: record.scopes,
    expiresAt: record.expiresAt,
    lastUsedAt: record.lastUsedAt,
    revokedAt: record.revokedAt,
    createdAt: record.createdAt,
  };
}
