import { randomBytes } from 'node:crypto';
import { env } from '../../config/env.js';
import { withDbClient, withTransaction, type DbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { hashAccessToken } from './token-hash.js';
import { PortalHandoffRepository } from './portal-handoff.repo.js';

const HANDOFF_CODE_TTL_MS = 5 * 60 * 1000;
const CODE_PREFIX = 'cp_ph_';

export type CreatedPortalHandoffCode = {
  portalUrl: string;
};

export type ExchangedPortalHandoffCode = {
  accountId: string;
  email: string | null;
  csrfToken: string;
  expiresAt: number;
};

export class PortalHandoffService {
  constructor(
    private readonly handoffRepo: PortalHandoffRepository = new PortalHandoffRepository(),
  ) {}

  async createForUser(authSubject: string, redirectPath: string): Promise<CreatedPortalHandoffCode> {
    const normalizedPath = normalizeRedirectPath(redirectPath);
    const portalUrl = env.accountPortalUrl;

    const plaintextCode = `${CODE_PREFIX}${randomBytes(32).toString('base64url')}`;
    const codePreview = plaintextCode.slice(0, 16);
    const expiresAt = new Date(Date.now() + HANDOFF_CODE_TTL_MS).toISOString();

    await withDbClient((client) =>
      this.handoffRepo.create(client, {
        accountId: authSubject,
        codeHash: hashAccessToken(plaintextCode),
        codePreview,
        redirectPath: normalizedPath,
        expiresAt,
      }),
    );

    const query = new URLSearchParams({ code: plaintextCode, redirect: normalizedPath });
    return { portalUrl: `${portalUrl}/app-handoff?${query.toString()}` };
  }

  async exchange(code: string): Promise<ExchangedPortalHandoffCode> {
    const trimmed = code.trim();
    if (!trimmed.startsWith(CODE_PREFIX)) {
      throw new HttpError(400, 'Invalid portal handoff code.', undefined, 'invalid_portal_handoff_code');
    }

    return withTransaction(async (client: DbClient) => {
      const consumed = await this.handoffRepo.consumeActiveByHash(client, hashAccessToken(trimmed));
      if (!consumed) {
        throw new HttpError(409, 'Portal handoff code is expired, invalid, or already used.', undefined, 'portal_handoff_code_not_usable');
      }

      return {
        accountId: consumed.accountId,
        email: consumed.email,
        csrfToken: '',
        expiresAt: 0,
      };
    });
  }
}

function normalizeRedirectPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith('/')) {
    throw new HttpError(400, 'Redirect path must start with /.', undefined, 'invalid_redirect_path');
  }
  if (trimmed.length > 256) {
    throw new HttpError(400, 'Redirect path too long.', undefined, 'invalid_redirect_path');
  }
  return trimmed;
}
