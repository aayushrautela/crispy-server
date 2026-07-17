import { redis } from './redis.js';

const UNLOCK_TTL_SECONDS = 30 * 24 * 3600;

export function unlockKey(profileId: string, authSubject: string): string {
  return `profile_unlock:${profileId}:${authSubject}`;
}

export async function setProfileUnlocked(
  profileId: string,
  authSubject: string,
  ttlSeconds: number = UNLOCK_TTL_SECONDS,
): Promise<void> {
  await redis.set(unlockKey(profileId, authSubject), '1', 'EX', ttlSeconds);
}

export async function isProfileUnlocked(profileId: string, authSubject: string): Promise<boolean> {
  const value = await redis.get(unlockKey(profileId, authSubject));
  return value === '1';
}

export async function lockProfile(profileId: string, authSubject: string): Promise<void> {
  await redis.del(unlockKey(profileId, authSubject));
}
