import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { HttpError } from '../../lib/errors.js';
import { env } from '../../config/env.js';

const PORTAL_SESSION_COOKIE = 'crispy_portal_session';
const PORTAL_SESSION_TTL_SECONDS = 8 * 60 * 60;

export type PortalSession = {
  accountId: string;
  email: string | null;
  csrfToken: string;
  expiresAt: number;
};

type SignedTokenPayload = {
  purpose: 'portal_session';
  accountId: string;
  email?: string;
  csrfToken: string;
  expiresAt: number;
};

declare module 'fastify' {
  interface FastifyRequest {
    portalSession?: PortalSession;
    portalAuthOrigin?: 'jwt' | 'pat' | 'cookie';
  }

  interface FastifyInstance {
    getPortalSession(request: import('fastify').FastifyRequest): PortalSession | null;
    requirePortalSession(request: import('fastify').FastifyRequest): PortalSession;
    requirePortalSessionMutation(request: import('fastify').FastifyRequest): PortalSession;
    issuePortalSession(reply: import('fastify').FastifyReply, params: { accountId: string; email: string | null }): PortalSession;
    clearPortalSession(reply: import('fastify').FastifyReply): void;
  }
}

const portalSessionAuthPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorateRequest('portalSession');
  fastify.decorate('getPortalSession', (request: import('fastify').FastifyRequest) => readPortalSession(request));
  fastify.decorate('requirePortalSession', (request: import('fastify').FastifyRequest) => {
    const session = readPortalSession(request);
    if (!session) {
      throw new HttpError(401, 'Portal authentication required.');
    }
    request.portalSession = session;
    return session;
  });
  fastify.decorate('requirePortalSessionMutation', (request: import('fastify').FastifyRequest) => {
    const session = fastify.requirePortalSession(request);
    const csrfToken = readHeaderValue(request.headers['x-portal-csrf']);
    if (!csrfToken || !constantTimeMatch(csrfToken, session.csrfToken)) {
      throw new HttpError(403, 'Invalid portal CSRF token.');
    }
    return session;
  });
  fastify.decorate('issuePortalSession', (reply: import('fastify').FastifyReply, params: { accountId: string; email: string | null }) => {
    const expiresAt = nowInSeconds() + PORTAL_SESSION_TTL_SECONDS;
    const session: PortalSession = {
      accountId: params.accountId,
      email: params.email,
      csrfToken: randomBytes(24).toString('base64url'),
      expiresAt,
    };

    reply.header('set-cookie', serializeSessionCookie(sealToken({
      purpose: 'portal_session',
      accountId: session.accountId,
      email: session.email ?? '',
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt,
    }, env.portalSessionSecret), session.expiresAt));
    return session;
  });
  fastify.decorate('clearPortalSession', (reply: import('fastify').FastifyReply) => {
    reply.header('set-cookie', serializeExpiredSessionCookie());
  });
};

export default fp(portalSessionAuthPlugin, { name: 'portal-session-auth-plugin' });

function readPortalSession(request: import('fastify').FastifyRequest): PortalSession | null {
  const cached = request.portalSession;
  if (cached) {
    return cached;
  }

  const token = readCookie(request.headers.cookie, PORTAL_SESSION_COOKIE);
  if (!token) {
    return null;
  }

  const payload = unsealToken(token, env.portalSessionSecret);
  if (!payload || payload.purpose !== 'portal_session' || payload.expiresAt < nowInSeconds()) {
    return null;
  }

  const session = {
    accountId: payload.accountId,
    email: payload.email || null,
    csrfToken: payload.csrfToken,
    expiresAt: payload.expiresAt,
  };
  request.portalSession = session;
  return session;
}

function sealToken(payload: SignedTokenPayload, secret: string): string {
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
    if (payload.purpose !== 'portal_session' || typeof payload.expiresAt !== 'number') {
      return null;
    }
    if (typeof payload.accountId !== 'string' || !payload.accountId) {
      return null;
    }
    if (typeof payload.csrfToken !== 'string' || !payload.csrfToken) {
      return null;
    }
    if ('email' in payload && payload.email !== undefined && typeof payload.email !== 'string') {
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
  return serializeCookie(PORTAL_SESSION_COOKIE, value, {
    path: '/',
    httpOnly: true,
    secure: env.nodeEnv === 'production',
    sameSite: env.nodeEnv === 'production' ? 'None' : 'Lax',
    maxAge: Math.max(0, expiresAt - nowInSeconds()),
  });
}

function serializeExpiredSessionCookie(): string {
  return `${serializeCookie(PORTAL_SESSION_COOKIE, '', {
    path: '/',
    httpOnly: true,
    secure: env.nodeEnv === 'production',
    sameSite: env.nodeEnv === 'production' ? 'None' : 'Lax',
    maxAge: 0,
  })}; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

function serializeCookie(
  name: string,
  value: string,
  options: { path: string; httpOnly: boolean; secure: boolean; sameSite: 'Strict' | 'Lax' | 'None'; maxAge: number },
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
