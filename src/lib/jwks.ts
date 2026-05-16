import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload } from 'jose';
import { env } from '../config/env.js';
import { HttpError } from './errors.js';

const jwks = createRemoteJWKSet(new URL(env.authJwksUrl));

export type AuthTokenPayload = JWTPayload & {
  sub: string;
  email?: string;
};

export async function verifyAuthJwt(token: string): Promise<AuthTokenPayload> {
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: env.authJwtIssuer,
      audience: env.authJwtAudience,
    });

    return requireAuthPayloadSubject(payload);
  } catch (error) {
    if (!(error instanceof errors.JWKSNoMatchingKey)) {
      throw error;
    }

    return verifyAuthJwtWithAuthServer(token);
  }
}

async function verifyAuthJwtWithAuthServer(token: string): Promise<AuthTokenPayload> {
  if (!env.authPublishableKey) {
    throw new Error('Missing required environment variable: AUTH_PUBLISHABLE_KEY');
  }

  const response = await fetch(`${env.authAdminUrl}/user`, {
    headers: {
      apikey: env.authPublishableKey,
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new HttpError(401, 'Invalid bearer token.');
  }

  const user = await response.json() as {
    id?: unknown;
    email?: unknown;
    aud?: unknown;
  };

  return requireAuthPayloadSubject({
    sub: typeof user.id === 'string' ? user.id : undefined,
    email: typeof user.email === 'string' ? user.email : undefined,
    aud: typeof user.aud === 'string' || Array.isArray(user.aud) ? user.aud : undefined,
  });
}

function requireAuthPayloadSubject(payload: JWTPayload): AuthTokenPayload {
  if (typeof payload.sub !== 'string' || !payload.sub.trim()) {
    throw new Error('JWT subject missing');
  }

  if (payload.aud !== env.authJwtAudience) {
    throw new Error('JWT audience mismatch');
  }

  return payload as AuthTokenPayload;
}
