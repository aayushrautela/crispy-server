import { verifyProfileUnlockToken, type ProfileUnlockPayload } from '../../lib/profile-unlock-token.js';
import { HttpError } from '../../lib/errors.js';
import type { FastifyRequest, FastifyInstance } from 'fastify';

export interface ProfileUnlockGuardResult {
  profileId: string;
  authSubject: string;
}

export async function extractProfileUnlockToken(request: FastifyRequest): Promise<string | null> {
  const headerRaw = request.headers['x-profile-unlock-token'];
  const header = Array.isArray(headerRaw) ? headerRaw[0] : headerRaw;
  if (typeof header === 'string' && header.trim()) return header.trim();
  const query = request.query as Record<string, unknown> | undefined;
  if (query?.profileUnlockToken && typeof query.profileUnlockToken === 'string') {
    return query.profileUnlockToken.trim();
  }
  return null;
}

export async function requireProfileUnlock(
  request: FastifyRequest,
  profileId: string
): Promise<ProfileUnlockGuardResult> {
  const auth = request.auth;
  if (!auth?.appUserId) {
    throw new HttpError(401, 'Authentication required.');
  }
  const authSubject = auth.appUserId;

  // Try to get unlock token
  const unlockToken = await extractProfileUnlockToken(request);
  if (!unlockToken) {
    throw new HttpError(423, 'Profile is locked. Provide PIN unlock token.', { profileId }, 'PROFILE_LOCKED');
  }

  try {
    const payload = await verifyProfileUnlockToken(unlockToken);
    if (payload.profileId !== profileId) {
      throw new HttpError(403, 'Unlock token does not match profile.', { code: 'INVALID_UNLOCK_TOKEN' });
    }
    if (payload.sub !== authSubject) {
      throw new HttpError(403, 'Unlock token does not match authenticated user.', { code: 'INVALID_UNLOCK_TOKEN' });
    }
    return { profileId, authSubject };
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(403, 'Invalid or expired unlock token.', { code: 'INVALID_UNLOCK_TOKEN' });
  }
}