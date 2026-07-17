import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { env } from '../config/env.js';

const UNLOCK_TOKEN_ISSUER = 'crispy-server';
const UNLOCK_TOKEN_AUDIENCE = 'crispy-profile-unlock';
const UNLOCK_TOKEN_TTL_SECONDS = 15 * 60;

let encoder: TextEncoder | null = null;
function getEncoder(): TextEncoder {
  if (!encoder) {
    encoder = new TextEncoder();
  }
  return encoder;
}

async function getSecretKey(): Promise<Uint8Array> {
  const secret = env.authJwtSecret?.trim();
  if (!secret) {
    throw new Error('AUTH_JWT_SECRET is not configured');
  }
  return getEncoder().encode(secret);
}

export interface ProfileUnlockPayload extends JWTPayload {
  sub: string;
  profileId: string;
  typ: 'profile_unlock';
}

export async function signProfileUnlockToken(profileId: string, authSubject: string): Promise<string> {
  const key = await getSecretKey();
  return new SignJWT({ sub: authSubject, profileId, typ: 'profile_unlock' } as ProfileUnlockPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(UNLOCK_TOKEN_ISSUER)
    .setAudience(UNLOCK_TOKEN_AUDIENCE)
    .setExpirationTime(`${UNLOCK_TOKEN_TTL_SECONDS}s`)
    .sign(key);
}

export async function verifyProfileUnlockToken(token: string): Promise<ProfileUnlockPayload> {
  const key = await getSecretKey();
  const { payload } = await jwtVerify(token, key, {
    issuer: UNLOCK_TOKEN_ISSUER,
    audience: UNLOCK_TOKEN_AUDIENCE,
  });
  if (payload.typ !== 'profile_unlock' || typeof payload.profileId !== 'string') {
    throw new Error('Invalid profile unlock token');
  }
  return payload as ProfileUnlockPayload;
}