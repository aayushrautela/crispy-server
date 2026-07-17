import { HttpError } from '../../lib/errors.js';
import { isProfileUnlocked } from '../../lib/profile-unlock-store.js';
import type { FastifyRequest } from 'fastify';

export interface ProfilePinGuardDeps {
  profilePinService: {
    hasPin(profileId: string): Promise<boolean>;
  };
}

export async function requireProfileUnlock(
  request: FastifyRequest,
  profileId: string,
  deps: ProfilePinGuardDeps,
): Promise<void> {
  const auth = request.auth;
  if (!auth?.appUserId) {
    throw new HttpError(401, 'Authentication required.');
  }
  const authSubject = auth.appUserId;

  const hasPin = await deps.profilePinService.hasPin(profileId);
  if (!hasPin) return;

  const unlocked = await isProfileUnlocked(profileId, authSubject);
  if (!unlocked) {
    throw new HttpError(423, 'Profile is locked.', undefined, 'PROFILE_LOCKED');
  }
}
