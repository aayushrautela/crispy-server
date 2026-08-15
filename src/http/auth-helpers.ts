import { verifyAuthJwt, type AuthTokenPayload } from '../lib/jwks.js';
import { withTransaction, type DbClient } from '../lib/db.js';
import { HttpError } from '../lib/errors.js';
import { USER_DEFAULT_SCOPES, type UserAuthActor } from '../modules/auth/auth.types.js';
import { normalizeLanguageCode } from '../modules/i18n/supported-languages.js';
import { normalizeCountryCode } from '../modules/i18n/supported-countries.js';
import { validateAvatarId } from '../modules/profiles/avatars.js';
import { enqueueHomeSeed } from '../lib/queue.js';
import { getRecommenderNotifier } from '../modules/recommender-notifier/recommender-notifier.js';
import { logger } from '../config/logger.js';

export async function verifyAndUpsertAuthJwt(token: string): Promise<UserAuthActor> {
  let payload: AuthTokenPayload;
  try {
    payload = await verifyAuthJwt(token);
  } catch {
    throw new HttpError(401, 'Invalid bearer token.', undefined, 'invalid_bearer_token');
  }

  await withTransaction(async (client) => {
    await client.query('SELECT identity.upsert_account($1, $2, $3)', [
      payload.sub,
      typeof payload.email === 'string' ? payload.email : null,
      deriveProfileName(payload),
    ]);

    const signup = deriveSignupProfile(payload);
    if (!signup.ok) {
      throw new HttpError(
        409,
        'Signup is incomplete; profile name, language, and avatar are required.',
        { fields: signup.missing },
        'signup_incomplete',
      );
    }

    const result = await ensureAccountProfile(client, payload.sub, signup);
    if (result.created) {
      void enqueueHomeSeed({ accountId: payload.sub, profileId: result.profileId }).catch(() => {
        /* seed is best-effort; home falls back to empty state until seed completes */
      });
      getRecommenderNotifier()?.notifyRecompute({
        accountId: payload.sub,
        profileId: result.profileId,
        reason: 'profile_created',
      });
    }
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
 * Idempotently create the account's first profile during onboarding.
 *
 * Race-safety is provided by two layers:
 *  1. A per-account `pg_advisory_xact_lock` serializes concurrent first-login
 *     requests so only one bootstrap runs at a time (released on commit).
 *  2. `ON CONFLICT DO NOTHING` (no target) lets the database reject any
 *     duplicate — the new `(account_id, lower(trim(name)))` partial unique
 *     index, plus the existing per-account admin unique index — atomically,
 *     with no check-then-insert window.
 *
 * The bootstrapped profile is the account's admin (primary) profile. This
 * function only performs the idempotent DB writes and reports whether it
 * created the profile; callers own any downstream side effects so they fire
 * exactly once (on real creation, never when reusing a raced profile).
 */
let bootstrapConflictTotal = 0;

export async function ensureAccountProfile(
  client: DbClient,
  accountId: string,
  signup: { name: string; interfaceLanguage: string; region: string | null; avatarUrl: string },
): Promise<{ created: boolean; profileId: string }> {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [accountId]);

  const insert = await client.query<{ id: string }>(
    `INSERT INTO identity.profiles
       (account_id, name, interface_language, region, avatar_url, is_admin, sort_order, created_by_account_id)
     VALUES ($1::uuid, $2, $3, $4, $5, true, 0, $1::uuid)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [accountId, signup.name, signup.interfaceLanguage, signup.region, signup.avatarUrl],
  );

  const created = insert.rows[0];
  if (created) {
    const profileId = created.id;
    await client.query(
      `INSERT INTO identity.profile_members (profile_id, account_id, role)
       VALUES ($1::uuid, $2::uuid, 'owner')`,
      [profileId, accountId],
    );
    await client.query(
      `INSERT INTO identity.profile_preferences (profile_id, settings_json)
       VALUES ($1::uuid, '{}'::jsonb)`,
      [profileId],
    );
    return { created: true, profileId };
  }

  // Another request won the race (or the per-account admin index conflicted).
  // Reuse the existing profile instead of creating a duplicate.
  bootstrapConflictTotal += 1;
  logger.info(
    { event: 'profile_bootstrap_conflict_resolved', accountId, total: bootstrapConflictTotal },
    'profile bootstrap race resolved by unique constraint',
  );

  const existing = await client.query<{ id: string }>(
    `SELECT id FROM identity.profiles
     WHERE account_id = $1::uuid AND deleted_at IS NULL
     ORDER BY sort_order ASC, created_at ASC, id ASC
     LIMIT 1`,
    [accountId],
  );
  return { created: false, profileId: existing.rows[0]?.id ?? '' };
}

type SignupProfile =
  | { ok: true; name: string; interfaceLanguage: string; region: string | null; avatarUrl: string }
  | { ok: false; missing: string[] };

export function deriveSignupProfile(payload: Record<string, unknown>): SignupProfile {
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
