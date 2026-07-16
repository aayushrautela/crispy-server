import { HttpError } from '../../lib/errors.js';
import type { DbClient } from '../../lib/db.js';
import { requireDbIsoString } from '../../lib/time.js';
import { normalizeLanguageCode } from '../i18n/supported-languages.js';
import { normalizeCountryCode } from '../i18n/supported-countries.js';
import { validateAvatarUrl } from './avatar-url.js';

export type ProfileRecord = {
  id: string;
  profileGroupId: string;
  name: string;
  interfaceLanguage: string;
  region: string | null;
  avatarUrl: string | null;
  isAdmin: boolean;
  requirePinToAddProfiles: boolean;
  hasPin: boolean;
  isKids: boolean;
  sortOrder: number;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProfilePinRow = {
  profileId: string;
  pinHash: string | null;
  failedAttempts: number;
  lockedUntil: string | null;
  requirePinToAddProfiles: boolean;
};

const PROFILE_COLUMNS = `
  id, account_id AS profile_group_id, name, interface_language, region, avatar_url,
  is_admin, pin_hash IS NOT NULL AS has_pin, require_pin_to_add_profiles,
  is_kids, sort_order, created_by_account_id AS created_by_user_id, created_at, updated_at
`;

function normalizeRequiredProfileLanguage(value: unknown): string {
  return normalizeLanguageCode(value) ?? 'en';
}

function normalizeOptionalProfileRegion(value: unknown): string | null {
  return normalizeCountryCode(value);
}

function normalizeOptionalAvatarUrl(value: unknown): string | null {
  const result = validateAvatarUrl(value);
  if (!result.ok) {
    throw new HttpError(400, result.reason);
  }
  return result.url === '' ? null : result.url;
}

function mapProfile(row: Record<string, unknown>): ProfileRecord {
  return {
    id: String(row.id),
    profileGroupId: String(row.profile_group_id),
    name: String(row.name),
    interfaceLanguage: typeof row.interface_language === 'string' ? row.interface_language : 'en',
    region: typeof row.region === 'string' ? row.region : null,
    avatarUrl: typeof row.avatar_url === 'string' ? row.avatar_url : null,
    isAdmin: Boolean(row.is_admin),
    requirePinToAddProfiles: Boolean(row.require_pin_to_add_profiles),
    hasPin: Boolean(row.has_pin),
    isKids: Boolean(row.is_kids),
    sortOrder: Number(row.sort_order),
    createdByUserId: typeof row.created_by_user_id === 'string' ? String(row.created_by_account_id) : null,
    createdAt: requireDbIsoString(row.created_at as Date | string | null | undefined, 'identity.profiles.created_at'),
    updatedAt: requireDbIsoString(row.updated_at as Date | string | null | undefined, 'identity.profiles.updated_at'),
  };
}

function mapPinRow(row: Record<string, unknown>): ProfilePinRow {
  return {
    profileId: String(row.id),
    pinHash: typeof row.pin_hash === 'string' ? row.pin_hash : null,
    failedAttempts: Number(row.pin_failed_attempts ?? 0),
    lockedUntil: row.locked_until instanceof Date || typeof row.locked_until === 'string'
      ? String(row.locked_until)
      : null,
    requirePinToAddProfiles: Boolean(row.require_pin_to_add_profiles),
  };
}

export class ProfileRepository {
  async findById(client: DbClient, profileId: string): Promise<ProfileRecord | null> {
    const result = await client.query(
      `
        SELECT ${PROFILE_COLUMNS}
        FROM identity.profiles
        WHERE id = $1::uuid AND deleted_at IS NULL
      `,
      [profileId],
    );
    return result.rows[0] ? mapProfile(result.rows[0]) : null;
  }

  async findPinRow(client: DbClient, profileId: string): Promise<ProfilePinRow | null> {
    const result = await client.query(
      `
        SELECT id, pin_hash, pin_failed_attempts, pin_locked_until, require_pin_to_add_profiles
        FROM identity.profiles
        WHERE id = $1::uuid AND deleted_at IS NULL
      `,
      [profileId],
    );
    return result.rows[0] ? mapPinRow(result.rows[0]) : null;
  }

  async findAdminProfileForOwner(client: DbClient, ownerUserId: string): Promise<ProfileRecord | null> {
    const result = await client.query(
      `
        SELECT ${PROFILE_COLUMNS}
        FROM identity.profiles
        WHERE account_id = $1::uuid AND is_admin AND deleted_at IS NULL
        LIMIT 1
      `,
      [ownerUserId],
    );
    return result.rows[0] ? mapProfile(result.rows[0]) : null;
  }

  async findOwnerUserIdById(client: DbClient, profileId: string): Promise<string | null> {
    const result = await client.query(
      `
        SELECT account_id AS owner_user_id
        FROM identity.profiles
        WHERE id = $1::uuid AND deleted_at IS NULL
      `,
      [profileId],
    );

    return typeof result.rows[0]?.owner_user_id === 'string' ? result.rows[0].owner_user_id : null;
  }

  async listForProfileGroup(client: DbClient, profileGroupId: string): Promise<ProfileRecord[]> {
    const result = await client.query(
      `
        SELECT ${PROFILE_COLUMNS}
        FROM identity.profiles
        WHERE account_id = $1::uuid AND deleted_at IS NULL
        ORDER BY sort_order ASC, created_at ASC
      `,
      [profileGroupId],
    );
    return result.rows.map((row) => mapProfile(row));
  }

  async listForOwnerUser(client: DbClient, ownerUserId: string): Promise<ProfileRecord[]> {
    return this.listForProfileGroup(client, ownerUserId);
  }

  async listAll(client: DbClient, limit: number, offset: number): Promise<ProfileRecord[]> {
    const result = await client.query(
      `
        SELECT ${PROFILE_COLUMNS}
        FROM identity.profiles
        WHERE deleted_at IS NULL
        ORDER BY updated_at DESC, created_at DESC
        LIMIT $1 OFFSET $2
      `,
      [limit, offset],
    );
    return result.rows.map((row) => mapProfile(row));
  }

  async findByIdForOwnerUser(client: DbClient, profileId: string, ownerUserId: string): Promise<ProfileRecord | null> {
    const result = await client.query(
      `
        SELECT ${PROFILE_COLUMNS}
        FROM identity.profiles
        WHERE id = $1::uuid AND account_id = $2::uuid AND deleted_at IS NULL
      `,
      [profileId, ownerUserId],
    );
    return result.rows[0] ? mapProfile(result.rows[0]) : null;
  }

  async create(client: DbClient, params: {
    profileGroupId: string;
    name: string;
    interfaceLanguage?: string;
    region?: string | null;
    avatarUrl?: string | null;
    isAdmin?: boolean;
    isKids?: boolean;
    sortOrder: number;
    createdByUserId: string;
  }): Promise<ProfileRecord> {
    const result = await client.query(
      `
        INSERT INTO identity.profiles (account_id, name, interface_language, region, avatar_url, is_admin, is_kids, sort_order, created_by_account_id)
        VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::uuid)
        RETURNING ${PROFILE_COLUMNS}
      `,
      [
        params.profileGroupId,
        params.name,
        normalizeRequiredProfileLanguage(params.interfaceLanguage ?? 'en'),
        normalizeOptionalProfileRegion(params.region),
        normalizeOptionalAvatarUrl(params.avatarUrl ?? null),
        params.isAdmin ?? false,
        params.isKids ?? false,
        params.sortOrder,
        params.createdByUserId,
      ],
    );
    const profile = mapProfile(result.rows[0]);
    await client.query(
      `INSERT INTO identity.profile_members (profile_id, account_id, role)
       VALUES ($1::uuid, $2::uuid, 'owner')
       ON CONFLICT (profile_id, account_id) DO UPDATE SET role = EXCLUDED.role`,
      [profile.id, params.profileGroupId],
    );
    await client.query(
      `INSERT INTO identity.profile_preferences (profile_id, settings_json)
       VALUES ($1::uuid, '{}'::jsonb)
       ON CONFLICT (profile_id) DO NOTHING`,
      [profile.id],
    );
    return profile;
  }

  async update(client: DbClient, params: {
    profileId: string;
    ownerUserId: string;
    name?: string;
    interfaceLanguage?: string;
    region?: string | null;
    avatarUrl?: string | null;
    isKids?: boolean;
    sortOrder?: number;
  }): Promise<ProfileRecord | null> {
    const current = await this.findByIdForOwnerUser(client, params.profileId, params.ownerUserId);
    if (!current) {
      return null;
    }

    const result = await client.query(
      `
        UPDATE identity.profiles
        SET
          name = $3,
          interface_language = $4,
          region = $5,
          avatar_url = $6,
          is_kids = $7,
          sort_order = $8,
          updated_at = now()
        WHERE id = $1::uuid AND account_id = $2::uuid AND deleted_at IS NULL
        RETURNING ${PROFILE_COLUMNS}
      `,
      [
        params.profileId,
        current.profileGroupId,
        params.name ?? current.name,
        params.interfaceLanguage === undefined ? current.interfaceLanguage : normalizeRequiredProfileLanguage(params.interfaceLanguage),
        params.region === undefined ? current.region : normalizeOptionalProfileRegion(params.region),
        params.avatarUrl === undefined ? current.avatarUrl : normalizeOptionalAvatarUrl(params.avatarUrl),
        params.isKids ?? current.isKids,
        params.sortOrder ?? current.sortOrder,
      ],
    );
    return result.rows[0] ? mapProfile(result.rows[0]) : null;
  }

  async updatePin(client: DbClient, profileId: string, params: {
    pinHash: string | null;
    failedAttempts: number;
    lockedUntil: string | null;
  }): Promise<void> {
    await client.query(
      `
        UPDATE identity.profiles
        SET pin_hash = $2, pin_failed_attempts = $3, pin_locked_until = $4::timestamptz, updated_at = now()
        WHERE id = $1::uuid AND deleted_at IS NULL
      `,
      [profileId, params.pinHash, params.failedAttempts, params.lockedUntil],
    );
  }

  async setRequirePinToAddProfiles(client: DbClient, adminProfileId: string, ownerUserId: string, value: boolean): Promise<ProfileRecord | null> {
    const result = await client.query(
      `
        UPDATE identity.profiles
        SET require_pin_to_add_profiles = $3, updated_at = now()
        WHERE id = $1::uuid AND account_id = $2::uuid AND is_admin AND deleted_at IS NULL
        RETURNING ${PROFILE_COLUMNS}
      `,
      [adminProfileId, ownerUserId, value],
    );
    return result.rows[0] ? mapProfile(result.rows[0]) : null;
  }
}
