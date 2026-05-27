import { randomBytes, createHash } from 'node:crypto';
import { env } from '../../config/env.js';
import { withDbClient, withTransaction } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import type { AuthScope } from './auth.types.js';
import { PAT_DEFAULT_SCOPES } from './auth.types.js';
import { PersonalAccessTokenRepository } from './personal-access-token.repo.js';
import { hashAccessToken } from './token-hash.js';
import { AppLoginHandoffRepository } from './app-login-handoff.repo.js';

const VALID_CLIENT_IDS = ['crispy-web', 'crispy-ios', 'crispy-android', 'crispy-desktop'] as const;

export type AppLoginHandoffCodeView = {
  id: string;
  codePreview: string;
  clientId: string;
  returnUri: string;
  state: string;
  expiresAt: string;
  consumedAt: string | null;
  createdAt: string;
};

export type CreatedAppLoginHandoffCode = {
  code: AppLoginHandoffCodeView;
  plaintextCode: string;
  redirectUri: string;
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

  async createForUser(authSubject: string, input: {
    clientId: string;
    returnUri: string;
    codeChallenge: string;
    codeChallengeMethod: string;
    state: string;
  }): Promise<CreatedAppLoginHandoffCode> {
    const clientId = normalizeClientId(input.clientId);
    const returnUri = validateReturnUri(clientId, input.returnUri);
    const codeChallenge = normalizePkceChallenge(input.codeChallenge);
    normalizePkceMethod(input.codeChallengeMethod);
    const normalizedState = normalizeState(input.state);

    const plaintextCode = `${CODE_PREFIX}${randomBytes(32).toString('base64url')}`;
    const codePreview = plaintextCode.slice(0, 16);
    const expiresAt = new Date(Date.now() + HANDOFF_CODE_TTL_MS).toISOString();

    const record = await withDbClient((client) => this.handoffRepo.create(client, {
      accountId: authSubject,
      codeHash: hashAccessToken(plaintextCode),
      codePreview,
      clientId,
      returnUri,
      codeChallenge,
      codeChallengeMethod: 'S256',
      state: normalizedState,
      expiresAt,
    }));

    const redirectUri = appendQueryParams(returnUri, { code: plaintextCode, state: normalizedState });

    return {
      code: mapCodeView(record),
      plaintextCode,
      redirectUri,
    };
  }

  async exchange(input: { code: string; codeVerifier: string; deviceName?: string | null }): Promise<ExchangedAppLoginHandoffCode> {
    const code = input.code.trim();
    if (!code.startsWith(CODE_PREFIX)) {
      throw new HttpError(400, 'Invalid app login code.', undefined, 'invalid_app_login_code');
    }

    const deviceName = normalizeDeviceName(input.deviceName);
    const codeVerifier = input.codeVerifier.trim();
    if (!codeVerifier || codeVerifier.length < 43 || codeVerifier.length > 128) {
      throw new HttpError(400, 'Invalid code verifier.', undefined, 'invalid_code_verifier');
    }

    const plaintextToken = `${TOKEN_PREFIX}${randomBytes(24).toString('base64url')}`;
    const tokenHash = hashAccessToken(plaintextToken);
    const expiresAt = new Date(Date.now() + APP_SESSION_TTL_MS).toISOString();

    return withTransaction(async (client) => {
      const consumed = await this.handoffRepo.consumeActiveByHash(client, hashAccessToken(code));
      if (!consumed) {
        throw new HttpError(409, 'App login code is expired, invalid, or already used.', undefined, 'app_login_code_not_usable');
      }

      const computedChallenge = computeS256Challenge(codeVerifier);
      if (computedChallenge !== consumed.codeChallenge) {
        throw new HttpError(400, 'Code verifier does not match.', undefined, 'code_verifier_mismatch');
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

function computeS256Challenge(verifier: string): string {
  const hash = createHash('sha256').update(verifier).digest();
  return Buffer.from(hash).toString('base64url');
}

function normalizeClientId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new HttpError(400, 'Client ID is required.', undefined, 'invalid_client_id');
  }
  if (!VALID_CLIENT_IDS.includes(trimmed as typeof VALID_CLIENT_IDS[number])) {
    throw new HttpError(400, 'Unknown client ID.', undefined, 'invalid_client_id');
  }
  return trimmed;
}

function validateReturnUri(clientId: string, returnUri: string): string {
  const trimmed = returnUri.trim();
  if (!trimmed || trimmed.length > 2048) {
    throw new HttpError(400, 'Invalid return URI.', undefined, 'invalid_return_uri');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new HttpError(400, 'Return URI is not a valid URL.', undefined, 'invalid_return_uri');
  }

  if (parsed.protocol === 'javascript:' || !parsed.protocol) {
    throw new HttpError(400, 'Invalid return URI protocol.', undefined, 'invalid_return_uri');
  }

  // Desktop loopback: allow http://127.0.0.1:<port>/auth/callback with any port
  if (clientId === 'crispy-desktop') {
    if (parsed.protocol === 'http:' && (parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]' || parsed.hostname === 'localhost') && parsed.port && parsed.pathname === '/auth/callback') {
      return parsed.toString();
    }
    if (parsed.protocol === 'http:' && parsed.hostname === 'localhost' && parsed.port && parsed.pathname === '/auth/callback') {
      return parsed.toString();
    }
    throw new HttpError(400, 'Desktop return URI must be a loopback address.', undefined, 'invalid_return_uri');
  }

  // Check allowlist
  const allowed = env.appLoginAllowedReturnUris.get(clientId);
  if (!allowed || !allowed.has(trimmed)) {
    throw new HttpError(400, 'Return URI is not allowed for this client.', undefined, 'return_uri_not_allowed');
  }

  return trimmed;
}

function normalizePkceChallenge(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length < 43 || trimmed.length > 128) {
    throw new HttpError(400, 'Invalid code challenge.', undefined, 'invalid_code_challenge');
  }
  if (!/^[A-Za-z0-9\-_]+$/.test(trimmed)) {
    throw new HttpError(400, 'Code challenge contains invalid characters.', undefined, 'invalid_code_challenge');
  }
  return trimmed;
}

function normalizePkceMethod(value: string): void {
  if (value !== 'S256') {
    throw new HttpError(400, 'Only S256 code challenge method is supported.', undefined, 'invalid_code_challenge_method');
  }
}

function normalizeState(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length < 16 || trimmed.length > 256) {
    throw new HttpError(400, 'State parameter must be between 16 and 256 characters.', undefined, 'invalid_state');
  }
  return trimmed;
}

function normalizeDeviceName(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 80);
}

function appendQueryParams(uri: string, params: Record<string, string>): string {
  const parsed = new URL(uri);
  for (const [key, value] of Object.entries(params)) {
    parsed.searchParams.set(key, value);
  }
  return parsed.toString();
}

function mapCodeView(record: {
  id: string;
  codePreview: string;
  clientId: string;
  returnUri: string;
  state: string;
  expiresAt: string;
  consumedAt: string | null;
  createdAt: string;
}): AppLoginHandoffCodeView {
  return {
    id: record.id,
    codePreview: record.codePreview,
    clientId: record.clientId,
    returnUri: record.returnUri,
    state: record.state,
    expiresAt: record.expiresAt,
    consumedAt: record.consumedAt,
    createdAt: record.createdAt,
  };
}
