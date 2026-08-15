import { verifyAuthJwt, type AuthTokenPayload } from '../lib/jwks.js';
import { db } from '../lib/db.js';
import { USER_DEFAULT_SCOPES, type UserAuthActor } from '../modules/auth/auth.types.js';
import { normalizeLanguageCode } from '../modules/i18n/supported-languages.js';
import { normalizeCountryCode } from '../modules/i18n/supported-countries.js';
import { validateAvatarId } from '../modules/profiles/avatars.js';
import { enqueueHomeSeed } from '../lib/queue.js';
import { getRecommenderNotifier } from '../modules/recommender-notifier/recommender-notifier.js';

export async function verifyAndUpsertAuthJwt(token: string): Promise<UserAuthActor> {
  let payload: AuthTokenPayload;
  try {
    payload = await verifyAuthJwt(token);
  } catch {
    throw Object.assign(new Error('Invalid bearer token.'), { statusCode: 401 });
  }

  const client = await db.connect();
  try {
    await client.query('SELECT identity.upsert_account($1, $2, $3)', [
      payload.sub,
      typeof payload.email === 'string' ? payload.email : null,
      deriveProfileName(payload),
    ]);

    const profileCheck = await client.query(
      `SELECT id FROM identity.profiles WHERE account_id = $1::uuid AND deleted_at IS NULL LIMIT 1`,
      [payload.sub],
    );
    if (profileCheck.rows.length === 0) {
      const signup = deriveSignupProfile(payload);
      if (!signup.ok) {
        throw Object.assign(new Error('Signup is incomplete; profile name, language, and avatar are required.'), {
          statusCode: 409,
          code: 'signup_incomplete',
          fields: signup.missing,
        });
      }

      const profileResult = await client.query(
        `INSERT INTO identity.profiles (account_id, name, interface_language, region, avatar_url, sort_order, created_by_account_id)
         VALUES ($1::uuid, $2, $3, $4, $5, 0, $1::uuid)
         RETURNING id`,
        [payload.sub, signup.name, signup.interfaceLanguage, signup.region, signup.avatarUrl],
      );
      const profileId = profileResult.rows[0].id;
      await client.query(
        `INSERT INTO identity.profile_members (profile_id, account_id, role)
         VALUES ($1::uuid, $2::uuid, 'owner')`,
        [profileId, payload.sub],
      );
      await client.query(
        `INSERT INTO identity.profile_preferences (profile_id, settings_json)
         VALUES ($1::uuid, '{}'::jsonb)`,
        [profileId],
      );

      void enqueueHomeSeed({ accountId: payload.sub, profileId }).catch(() => {
        /* seed is best-effort; home falls back to empty state until seed completes */
      });
      getRecommenderNotifier()?.notifyRecompute({
        accountId: payload.sub,
        profileId,
        reason: 'profile_created',
      });
    }
  } finally {
    client.release();
  }

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

type SignupProfile =
  | { ok: true; name: string; interfaceLanguage: string; region: string | null; avatarUrl: string }
  | { ok: false; missing: string[] };

function deriveSignupProfile(payload: Record<string, unknown>): SignupProfile {
  const missing: string[] = [];

  const name = deriveProfileName(payload);
  if (!name) missing.push('name');

  const rawLanguage = readMetadataString(payload, 'interfaceLanguage')
    ?? readMetadataString(payload, 'interface_language')
    ?? readMetadataString(payload, 'locale')
    ?? readMetadataString(payload, 'language');
  const interfaceLanguage = normalizeLanguageCode(rawLanguage);
  if (!interfaceLanguage) missing.push('interfaceLanguage');

  const rawRegion = readMetadataString(payload, 'region')
    ?? readMetadataString(payload, 'country')
    ?? readMetadataString(payload, 'country_code');
  const region = rawRegion === null ? null : normalizeCountryCode(rawRegion);
  if (rawRegion !== null && !region) missing.push('region');

  const rawAvatar = readMetadataString(payload, 'avatarUrl')
    ?? readMetadataString(payload, 'avatar_url');
  const avatar = validateAvatarId(rawAvatar);
  if (!avatar.ok) missing.push('avatarUrl');

  if (missing.length > 0) {
    return { ok: false, missing: Array.from(new Set(missing)) };
  }

  return {
    ok: true,
    name: name as string,
    interfaceLanguage: interfaceLanguage as string,
    region,
    avatarUrl: (avatar as { ok: true; id: string }).id,
  };
}

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

function normalizeRegion(value: string): string | null {
  const region = value.trim().replaceAll('_', '-');
  if (!/^[A-Za-z]{2}(?:-[A-Za-z0-9]{2,8}){0,2}$/.test(region)) return null;
  return region
    .split('-')
    .map((part, index) => (index === 0 || part.length === 2 ? part.toUpperCase() : part.toLowerCase()))
    .join('-');
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
