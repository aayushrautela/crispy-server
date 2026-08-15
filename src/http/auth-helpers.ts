import { verifyAuthJwt, type AuthTokenPayload } from '../lib/jwks.js';
import { withTransaction } from '../lib/db.js';
import { HttpError } from '../lib/errors.js';
import { USER_DEFAULT_SCOPES, type UserAuthActor } from '../modules/auth/auth.types.js';

export async function verifyAndUpsertAuthJwt(token: string): Promise<UserAuthActor> {
  let payload: AuthTokenPayload;
  try {
    payload = await verifyAuthJwt(token);
  } catch {
    throw new HttpError(401, 'Invalid bearer token.', undefined, 'invalid_bearer_token');
  }

  // Ensure the identity.account row exists for this auth subject. Profile
  // creation is intentionally NOT performed here: the first (primary) profile
  // is created by the explicit POST /v1/account/bootstrap endpoint so the
  // client owns a single, guided onboarding step. See account-bootstrap.ts.
  await withTransaction(async (client) => {
    await client.query('SELECT identity.upsert_account($1, $2, $3)', [
      payload.sub,
      typeof payload.email === 'string' ? payload.email : null,
      deriveProfileName(payload),
    ]);
  });

  return {
    type: 'user',
    appUserId: payload.sub,
    serviceId: null,
    scopes: USER_DEFAULT_SCOPES,
    authSubject: payload.sub,
    email: payload.email ?? null,
    tokenId: null,
    consumerId: null,
    accessToken: null,
  };
}

/**
 * Derive a display name for the identity.account row from the auth token.
 * Falls back to the email local-part when no explicit name is present. This is
 * only used to populate the denormalized account name; the *profile* name is
 * provided explicitly during onboarding (POST /v1/account/bootstrap) and is
 * mandatory there.
 */
function deriveProfileName(payload: Record<string, unknown>): string {
  for (const key of ['full_name', 'name', 'display_name']) {
    const value = readMetadataString(payload, key);
    if (value) return value;
  }
  if (typeof payload.email === 'string') {
    const localPart = payload.email.split('@')[0]?.trim();
    if (localPart) return localPart;
  }
  return '';
}

function readMetadataString(payload: Record<string, unknown>, key: string): string | null {
  for (const container of [payload, asRecord(payload.user_metadata), asRecord(payload.raw_user_meta_data), asRecord(payload.app_metadata)]) {
    const value = container?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

const PROFILE_HEADER = 'x-profile-id';

export function getProfileIdFromRequest(request: import('fastify').FastifyRequest): string | null {
  const header = request.headers[PROFILE_HEADER];
  if (Array.isArray(header)) return header[0] ?? null;
  return header ?? null;
}

export interface AdminProfileContext {
  id: string;
  accountId: string;
  isAdmin: true;
}

export interface ProfileForAdminLookup {
  id: string;
  accountId: string;
  isAdmin: boolean;
  hasPin: boolean;
}

export type AdminProfileLookup = (profileId: string, authSubject: string) => Promise<ProfileForAdminLookup | null>;

export function createRequireAdminProfile(lookup: AdminProfileLookup): (request: import('fastify').FastifyRequest) => Promise<AdminProfileContext> {
  return async (request): Promise<AdminProfileContext> => {
    const { HttpError } = await import('../lib/errors.js');
    const actor = request.server.requireUserActor(request);

    const profileId = getProfileIdFromRequest(request);
    if (!profileId) {
      throw new HttpError(400, 'Profile context required. Provide X-Profile-ID header.', undefined, 'profile_context_required');
    }
    const id: string = profileId;
    const authSubject: string = actor.authSubject!;

    const profile = await lookup(id, authSubject);
    if (!profile) {
      throw new HttpError(404, 'Profile not found.');
    }
    if (profile.accountId !== actor.authSubject) {
      throw new HttpError(403, 'Profile does not belong to authenticated account.');
    }
    if (!profile.isAdmin) {
      throw new HttpError(403, 'Admin profile required.', undefined, 'admin_profile_required');
    }
    if (profile.hasPin) {
      const { isProfileUnlocked } = await import('../lib/profile-unlock-store.js');
      const unlocked = await isProfileUnlocked(profile.id, actor.authSubject);
      if (!unlocked) {
        throw new HttpError(423, 'Admin profile is locked. Verify PIN to continue.', undefined, 'PROFILE_LOCKED');
      }
    }
    return { id: profile.id, accountId: profile.accountId, isAdmin: true };
  };
}

export function getProfileHeaderName(): string {
  return PROFILE_HEADER;
}
