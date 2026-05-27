import { verifyAuthJwt, type AuthTokenPayload } from '../lib/jwks.js';
import { db } from '../lib/db.js';
import { USER_DEFAULT_SCOPES, type UserAuthActor } from '../modules/auth/auth.types.js';
import { normalizeMetadataLanguage } from '../modules/metadata/metadata-language.js';

export async function verifyAndUpsertAuthJwt(token: string): Promise<UserAuthActor> {
  let payload: AuthTokenPayload;
  try {
    payload = await verifyAuthJwt(token);
  } catch {
    throw Object.assign(new Error('Invalid bearer token.'), { statusCode: 401 });
  }

  const displayName = deriveProfileName(payload);
  const interfaceLanguage = deriveProfileLanguage(payload);
  const region = deriveProfileRegion(payload);
  const client = await db.connect();
  try {
    await client.query('SELECT identity.upsert_account($1, $2, $3)', [
      payload.sub,
      typeof payload.email === 'string' ? payload.email : null,
      displayName,
    ]);

    const profileCheck = await client.query(
      `SELECT id FROM identity.profiles WHERE account_id = $1::uuid AND deleted_at IS NULL LIMIT 1`,
      [payload.sub],
    );
    if (profileCheck.rows.length === 0) {
      const profileResult = await client.query(
        `INSERT INTO identity.profiles (account_id, name, interface_language, region, sort_order, created_by_account_id)
         VALUES ($1::uuid, $2, $3, $4, 0, $1::uuid)
         RETURNING id`,
        [payload.sub, displayName, interfaceLanguage, region],
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

function deriveProfileName(payload: Record<string, unknown>): string {
  for (const key of ['full_name', 'name', 'display_name']) {
    const value = readMetadataString(payload, key);
    if (value) return value;
  }
  if (typeof payload.email === 'string') {
    const localPart = payload.email.split('@')[0]?.trim();
    if (localPart) return localPart;
  }
  return 'Main';
}

function deriveProfileLanguage(payload: Record<string, unknown>): string {
  for (const key of ['interfaceLanguage', 'interface_language', 'locale', 'language']) {
    const normalized = normalizeMetadataLanguage(readMetadataString(payload, key));
    if (normalized) return normalized;
  }
  return 'en';
}

function deriveProfileRegion(payload: Record<string, unknown>): string | null {
  for (const key of ['region', 'country', 'country_code']) {
    const value = readMetadataString(payload, key);
    if (value) return normalizeRegion(value);
  }
  return null;
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
