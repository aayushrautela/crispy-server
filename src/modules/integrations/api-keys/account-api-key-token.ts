import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

export interface AccountApiKeyToken {
  plaintextToken: string;
  prefix: string;
  secret: string;
}

export function generateAccountApiKeyToken(): AccountApiKeyToken {
  const prefix = randomBytes(8).toString('base64url');
  const secret = randomBytes(24).toString('base64url');
  const plaintextToken = `crispy_live_${prefix}_${secret}`;

  return {
    plaintextToken,
    prefix,
    secret,
  };
}

export function hashAccountApiKeySecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export function verifyAccountApiKeySecret(secret: string, hash: string): boolean {
  const computedHash = hashAccountApiKeySecret(secret);
  
  if (computedHash.length !== hash.length) {
    return false;
  }

  try {
    return timingSafeEqual(Buffer.from(computedHash, 'hex'), Buffer.from(hash, 'hex'));
  } catch {
    return false;
  }
}

export function parseAccountApiKeyToken(token: string): { prefix: string; secret: string } | null {
  const match = /^crispy_live_([A-Za-z0-9_-]+)_([A-Za-z0-9_-]+)$/.exec(token);
  if (!match) {
    return null;
  }

  const prefix = match[1];
  const secret = match[2];
  if (!prefix || !secret) {
    return null;
  }

  return {
    prefix,
    secret,
  };
}
