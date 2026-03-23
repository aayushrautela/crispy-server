import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { env } from '../config/env.js';

const jwks = createRemoteJWKSet(new URL(env.authJwksUrl));

export type AuthTokenPayload = JWTPayload & {
  sub: string;
  email?: string;
};

export async function verifyAuthJwt(token: string): Promise<AuthTokenPayload> {
  const { payload } = await jwtVerify(token, jwks, {
    issuer: env.authJwtIssuer,
    audience: env.authJwtAudience,
  });

  if (typeof payload.sub !== 'string' || !payload.sub.trim()) {
    throw new Error('JWT subject missing');
  }

  return payload as AuthTokenPayload;
}
