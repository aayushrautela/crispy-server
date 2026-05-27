import { randomBytes } from 'node:crypto';
import { withDbClient, withTransaction } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import type { AuthScope } from './auth.types.js';
import { PAT_DEFAULT_SCOPES } from './auth.types.js';
import { PersonalAccessTokenRepository } from './personal-access-token.repo.js';
import { hashAccessToken } from './token-hash.js';
import { AppLoginHandoffRepository } from './app-login-handoff.repo.js';

export type AppLoginHandoffCodeView = {
  id: string;
  codePreview: string;
  returnUri: string | null;
  expiresAt: string;
  consumedAt: string | null;
  createdAt: string;
};

export type CreatedAppLoginHandoffCode = {
  code: AppLoginHandoffCodeView;
  plaintextCode: string;
  redirectUri: string | null;
};

export type ExchangedAppLoginHandoffCode = {
  token: {
    id: string;
    name: string;
    tokenPreview: string;
    scopes: AuthScope[];
    expiresAt: string | null;
    lastUsedAt: string | null;
    revokedAt: string | null;
    createdAt: string;
  };
  plaintextToken: string;
  user: {
    id: string;
    email: string | null;
  };
};

const HANDOFF_CODE_TTL_MS = 5 * 60 * 1000;
const APP_SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const CODE_PREFIX = 'cp_login_';
const TOKEN_PREFIX = 'cp_pat_';
const DEFAULT_APP_SESSION_SCOPES = PAT_DEFAULT_SCOPES;

export class AppLoginHandoffService {
  constructor(
    private readonly handoffRepo: AppLoginHandoffRepository = new AppLoginHandoffRepository(),
    private readonly tokenRepo: PersonalAccessTokenRepository = new PersonalAccessTokenRepository(),
  ) {}

  async createForUser(authSubject: string, input: { returnUri?: string | null }): Promise<CreatedAppLoginHandoffCode> {
    const returnUri = normalizeReturnUri(input.returnUri);
    const plaintextCode = `${CODE_PREFIX}${randomBytes(32).toString('base64url')}`;
    const codePreview = plaintextCode.slice(0, 16);
    const expiresAt = new Date(Date.now() + HANDOFF_CODE_TTL_MS).toISOString();

    const record = await withDbClient((client) => this.handoffRepo.create(client, {
      accountId: authSubject,
      codeHash: hashAccessToken(plaintextCode),
      codePreview,
      returnUri,
      expiresAt,
    }));

    return {
      code: mapCodeView(record),
      plaintextCode,
      redirectUri: returnUri ? appendQueryParam(returnUri, 'code', plaintextCode) : null,
    };
  }

  async exchange(input: { code: string; deviceName?: string | null }): Promise<ExchangedAppLoginHandoffCode> {
    const code = input.code.trim();
    if (!code.startsWith(CODE_PREFIX)) {
      throw new HttpError(400, 'Invalid app login code.', undefined, 'invalid_app_login_code');
    }

    const deviceName = normalizeDeviceName(input.deviceName);
    const plaintextToken = `${TOKEN_PREFIX}${randomBytes(24).toString('base64url')}`;
    const tokenHash = hashAccessToken(plaintextToken);
    const expiresAt = new Date(Date.now() + APP_SESSION_TTL_MS).toISOString();

    return withTransaction(async (client) => {
      const consumed = await this.handoffRepo.consumeActiveByHash(client, hashAccessToken(code));
      if (!consumed) {
        throw new HttpError(409, 'App login code is expired, invalid, or already used.', undefined, 'app_login_code_not_usable');
      }

      const token = await this.tokenRepo.create(client, {
        userId: consumed.accountId,
        name: deviceName ? `App session: ${deviceName}` : 'App session',
        tokenHash,
        tokenPreview: plaintextToken.slice(0, 12),
        scopes: DEFAULT_APP_SESSION_SCOPES,
        expiresAt,
      });

      const emailResult = await client.query('SELECT email FROM identity.accounts WHERE id = $1::uuid', [consumed.accountId]);

      return {
        token: {
          id: token.id,
          name: token.name,
          tokenPreview: token.tokenPreview,
          scopes: token.scopes,
          expiresAt: token.expiresAt,
          lastUsedAt: token.lastUsedAt,
          revokedAt: token.revokedAt,
          createdAt: token.createdAt,
        },
        plaintextToken,
        user: {
          id: consumed.accountId,
          email: emailResult.rows[0]?.email ?? null,
        },
      };
    });
  }
}

function normalizeReturnUri(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 2048) {
    throw new HttpError(400, 'Return URI is too long.', undefined, 'return_uri_too_long');
  }
  try {
    const parsed = new URL(trimmed);
    if (!parsed.protocol || parsed.protocol === 'javascript:') {
      throw new Error('invalid protocol');
    }
    return parsed.toString();
  } catch {
    throw new HttpError(400, 'Return URI is invalid.', undefined, 'invalid_return_uri');
  }
}

function normalizeDeviceName(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 80);
}

function appendQueryParam(uri: string, key: string, value: string): string {
  const parsed = new URL(uri);
  parsed.searchParams.set(key, value);
  return parsed.toString();
}

function mapCodeView(record: {
  id: string;
  codePreview: string;
  returnUri: string | null;
  expiresAt: string;
  consumedAt: string | null;
  createdAt: string;
}): AppLoginHandoffCodeView {
  return {
    id: record.id,
    codePreview: record.codePreview,
    returnUri: record.returnUri,
    expiresAt: record.expiresAt,
    consumedAt: record.consumedAt,
    createdAt: record.createdAt,
  };
}
