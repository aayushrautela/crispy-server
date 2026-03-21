import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { env } from '../config/env.js';

const jwks = createRemoteJWKSet(new URL(env.supabaseJwksUrl));

export type AuthTokenPayload = JWTPayload & {
  sub: string;
  email?: string;
};

export async function verifySupabaseJwt(token: string): Promise<AuthTokenPayload> {
  const { payload } = await jwtVerify(token, jwks, {
    issuer: env.supabaseJwtIssuer,
    audience: env.supabaseJwtAudience,
  });

  if (typeof payload.sub !== 'string' || !payload.sub.trim()) {
    throw new Error('JWT subject missing');
  }

  return payload as AuthTokenPayload;
}
