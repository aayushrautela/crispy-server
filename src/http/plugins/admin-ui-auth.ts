import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { HttpError } from '../../lib/errors.js';
import { env } from '../../config/env.js';

const ADMIN_UI_SESSION_COOKIE = 'crispy_admin_session';
const ADMIN_UI_SESSION_TTL_SECONDS = 8 * 60 * 60;
const ADMIN_UI_FORM_TOKEN_TTL_SECONDS = 15 * 60;

type AdminUiSession = {
  username: string;
  csrfToken: string;
  expiresAt: number;
};

type AdminUiFormAction = 'login' | 'logout';

type SignedTokenPayload = {
  purpose: 'admin_session' | 'admin_form';
  expiresAt: number;
  username?: string;
  csrfToken?: string;
  action?: AdminUiFormAction;
};

declare module 'fastify' {
  interface FastifyInstance {
    getAdminUiConfigurationError(): string | null;
    getAdminUiSession(request: import('fastify').FastifyRequest): AdminUiSession | null;
    requireAdminUi(request: import('fastify').FastifyRequest): Promise<AdminUiSession>;
    requireAdminUiMutation(request: import('fastify').FastifyRequest): Promise<AdminUiSession>;
    verifyAdminUiCredentials(username: string, password: string): void;
    issueAdminUiSession(reply: import('fastify').FastifyReply): AdminUiSession;
    clearAdminUiSession(reply: import('fastify').FastifyReply): void;
    createAdminUiFormToken(action: AdminUiFormAction, session?: AdminUiSession): string;
    verifyAdminUiFormToken(
      request: import('fastify').FastifyRequest,
      token: string,
      action: AdminUiFormAction,
      session?: AdminUiSession,
    ): void;
  }
}

const adminUiAuthPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorate('getAdminUiConfigurationError', () => getAdminUiConfigurationError());
  fastify.decorate('getAdminUiSession', (request: import('fastify').FastifyRequest) => readAdminUiSession(request));
  fastify.decorate('requireAdminUi', async (request: import('fastify').FastifyRequest) => {
    assertAdminUiConfigured();
    const session = readAdminUiSession(request);
    if (!session) {
      throw new HttpError(401, 'Admin authentication required.');
    }
    return session;
  });
  fastify.decorate('requireAdminUiMutation', async (request: import('fastify').FastifyRequest) => {
    const session = await fastify.requireAdminUi(request);
    assertSameOrigin(request);
    const csrfToken = readHeaderValue(request.headers['x-admin-csrf']);
    if (!csrfToken || !constantTimeMatch(csrfToken, session.csrfToken)) {
      throw new HttpError(403, 'Invalid admin CSRF token.');
    }
    return session;
  });
  fastify.decorate('verifyAdminUiCredentials', (username: string, password: string) => {
    const config = getAdminUiConfig();
    if (!constantTimeMatch(username, config.user) || !constantTimeMatch(password, config.password)) {
      throw new HttpError(401, 'Invalid admin credentials.');
    }
  });
  fastify.decorate('issueAdminUiSession', (reply: import('fastify').FastifyReply) => {
    const config = getAdminUiConfig();
    const session: AdminUiSession = {
      username: config.user,
      csrfToken: randomBytes(24).toString('base64url'),
      expiresAt: nowInSeconds() + ADMIN_UI_SESSION_TTL_SECONDS,
    };

    reply.header('set-cookie', serializeSessionCookie(sealToken({
      purpose: 'admin_session',
      username: session.username,
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt,
    }, config.sessionSecret), session.expiresAt));
    return session;
  });
  fastify.decorate('clearAdminUiSession', (reply: import('fastify').FastifyReply) => {
    reply.header('set-cookie', serializeExpiredSessionCookie());
  });
  fastify.decorate('createAdminUiFormToken', (action: AdminUiFormAction, session?: AdminUiSession) => {
    const { sessionSecret } = getAdminUiConfig();
    return sealToken({
      purpose: 'admin_form',
      action,
      expiresAt: nowInSeconds() + ADMIN_UI_FORM_TOKEN_TTL_SECONDS,
      csrfToken: session?.csrfToken ?? '',
    }, sessionSecret);
  });
  fastify.decorate(
    'verifyAdminUiFormToken',
    (
      request: import('fastify').FastifyRequest,
      token: string,
      action: AdminUiFormAction,
      session?: AdminUiSession,
    ) => {
      assertAdminUiConfigured();
      assertSameOrigin(request);
      const payload = unsealToken(token, getAdminUiConfig().sessionSecret);
      if (!payload || payload.purpose !== 'admin_form' || payload.action !== action || payload.expiresAt < nowInSeconds()) {
        throw new HttpError(403, 'Invalid admin form token.');
      }
      if ((session?.csrfToken ?? '') !== payload.csrfToken) {
        throw new HttpError(403, 'Invalid admin form token.');
      }
    },
  );
};

export default fp(adminUiAuthPlugin, { name: 'admin-ui-auth-plugin' });

function getAdminUiConfigurationError(): string | null {
  if (!env.adminUiUser.trim() || !env.adminUiPassword.trim()) {
    return 'Admin UI credentials are not configured.';
  }
  if (!env.adminUiSessionSecret.trim()) {
    return 'Admin UI session secret is not configured.';
  }
  return null;
}

function assertAdminUiConfigured(): void {
  const error = getAdminUiConfigurationError();
  if (error) {
    throw new HttpError(503, error);
  }
}

function getAdminUiConfig(): { user: string; password: string; sessionSecret: string } {
  assertAdminUiConfigured();
  return {
    user: env.adminUiUser.trim(),
    password: env.adminUiPassword.trim(),
    sessionSecret: env.adminUiSessionSecret.trim(),
  };
}

function readAdminUiSession(request: import('fastify').FastifyRequest): AdminUiSession | null {
  const token = readCookie(request.headers.cookie, ADMIN_UI_SESSION_COOKIE);
  if (!token) {
    return null;
  }

  const sessionSecret = env.adminUiSessionSecret.trim();
  if (!sessionSecret) {
    return null;
  }

  const payload = unsealToken(token, sessionSecret);
  if (!payload || payload.purpose !== 'admin_session' || payload.expiresAt < nowInSeconds()) {
    return null;
  }
  if (typeof payload.username !== 'string' || typeof payload.csrfToken !== 'string') {
    return null;
  }
  return {
    username: payload.username,
    csrfToken: payload.csrfToken,
    expiresAt: payload.expiresAt,
  };
}

function assertSameOrigin(request: import('fastify').FastifyRequest): void {
  const expectedOrigin = getExpectedOrigin(request);
  if (!expectedOrigin) {
    throw new HttpError(400, 'Unable to determine admin request origin.');
  }

  const candidate = readHeaderValue(request.headers.origin) || extractRefererOrigin(readHeaderValue(request.headers.referer));
  if (!candidate) {
    throw new HttpError(403, 'Admin request origin is required.');
  }

  let actualOrigin = '';
  try {
    actualOrigin = new URL(candidate).origin;
  } catch {
    throw new HttpError(403, 'Invalid admin request origin.');
  }

  if (actualOrigin !== expectedOrigin) {
    throw new HttpError(403, 'Invalid admin request origin.');
  }
}

function getExpectedOrigin(request: import('fastify').FastifyRequest): string | null {
  const host = readHeaderValue(request.headers['x-forwarded-host']) || readHeaderValue(request.headers.host);
  if (!host) {
    return null;
  }
  const forwardedProto = readHeaderValue(request.headers['x-forwarded-proto']);
  const forwardedProtocol = forwardedProto
    ? (forwardedProto.split(',')[0] ?? '').trim()
    : '';
  const protocol = forwardedProtocol
    ? forwardedProtocol
    : env.nodeEnv === 'production'
      ? 'https'
      : 'http';
  return `${protocol}://${host}`;
}

function extractRefererOrigin(value: string | null): string | null {
  if (!value) {
    return null;
  }
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function sealToken(payload: Record<string, string | number>, secret: string): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = signValue(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

function unsealToken(token: string, secret: string): SignedTokenPayload | null {
  const separatorIndex = token.lastIndexOf('.');
  if (separatorIndex <= 0 || separatorIndex >= token.length - 1) {
    return null;
  }

  const encodedPayload = token.slice(0, separatorIndex);
  const signature = token.slice(separatorIndex + 1);
  if (!constantTimeMatch(signature, signValue(encodedPayload, secret))) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    const payload = parsed as Record<string, unknown>;
    if ((payload.purpose !== 'admin_session' && payload.purpose !== 'admin_form') || typeof payload.expiresAt !== 'number') {
      return null;
    }
    if ('username' in payload && payload.username !== undefined && typeof payload.username !== 'string') {
      return null;
    }
    if ('csrfToken' in payload && payload.csrfToken !== undefined && typeof payload.csrfToken !== 'string') {
      return null;
    }
    if ('action' in payload && payload.action !== undefined && payload.action !== 'login' && payload.action !== 'logout') {
      return null;
    }
    return payload as SignedTokenPayload;
  } catch {
    return null;
  }
}

function signValue(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function serializeSessionCookie(value: string, expiresAt: number): string {
  return serializeCookie(ADMIN_UI_SESSION_COOKIE, value, {
    path: '/admin',
    httpOnly: true,
    secure: env.nodeEnv === 'production',
    sameSite: 'Strict',
    maxAge: Math.max(0, expiresAt - nowInSeconds()),
  });
}

function serializeExpiredSessionCookie(): string {
  return `${serializeCookie(ADMIN_UI_SESSION_COOKIE, '', {
    path: '/admin',
    httpOnly: true,
    secure: env.nodeEnv === 'production',
    sameSite: 'Strict',
    maxAge: 0,
  })}; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

function serializeCookie(
  name: string,
  value: string,
  options: { path: string; httpOnly: boolean; secure: boolean; sameSite: 'Strict' | 'Lax'; maxAge: number },
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${options.path}`,
    `Max-Age=${Math.max(0, Math.trunc(options.maxAge))}`,
    `SameSite=${options.sameSite}`,
  ];
  if (options.httpOnly) {
    parts.push('HttpOnly');
  }
  if (options.secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

function readCookie(rawHeader: string | undefined, name: string): string | null {
  if (!rawHeader) {
    return null;
  }
  for (const part of rawHeader.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }
    const separatorIndex = trimmed.indexOf('=');
    const cookieName = separatorIndex >= 0 ? trimmed.slice(0, separatorIndex) : trimmed;
    if (cookieName !== name) {
      continue;
    }
    const cookieValue = separatorIndex >= 0 ? trimmed.slice(separatorIndex + 1) : '';
    try {
      return decodeURIComponent(cookieValue);
    } catch {
      return cookieValue;
    }
  }
  return null;
}

function readHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' && value[0].trim() ? value[0].trim() : null;
  }
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function nowInSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function constantTimeMatch(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(actualBuffer, expectedBuffer);
}
