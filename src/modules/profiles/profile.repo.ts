import type { DbClient } from '../../lib/db.js';
import { requireDbIsoString } from '../../lib/time.js';
import { normalizeMetadataLanguage } from '../metadata/metadata-language.js';

export type ProfileRecord = {
  id: string;
  profileGroupId: string;
  name: string;
  interfaceLanguage: string;
  region: string | null;
  avatarKey: string | null;
  isKids: boolean;
  sortOrder: number;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

function normalizeRequiredProfileLanguage(value: unknown): string {
  return normalizeMetadataLanguage(typeof value === 'string' ? value : null) ?? 'en';
}

function normalizeOptionalProfileRegion(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const region = value.trim().replaceAll('_', '-');
  if (!/^[A-Za-z]{2}(?:-[A-Za-z0-9]{2,8}){0,2}$/.test(region)) return null;
  return region
    .split('-')
    .map((part, index) => (index === 0 || part.length === 2 ? part.toUpperCase() : part.toLowerCase()))
    .join('-');
}

function mapProfile(row: Record<string, unknown>): ProfileRecord {
  return {
    id: String(row.id),
    profileGroupId: String(row.profile_group_id),
    name: String(row.name),
    interfaceLanguage: typeof row.interface_language === 'string' ? row.interface_language : 'en',
    region: typeof row.region === 'string' ? row.region : null,
    avatarKey: typeof row.avatar_key === 'string' ? row.avatar_key : null,
    isKids: Boolean(row.is_kids),
    sortOrder: Number(row.sort_order),
    createdByUserId: typeof row.created_by_user_id === 'string' ? row.created_by_user_id : null,
    createdAt: requireDbIsoString(row.created_at as Date | string | null | undefined, 'identity.profiles.created_at'),
    updatedAt: requireDbIsoString(row.updated_at as Date | string | null | undefined, 'identity.profiles.updated_at'),
  };
}

export class ProfileRepository {
  async findById(client: DbClient, profileId: string): Promise<ProfileRecord | null> {
    const result = await client.query(
      `
        SELECT id, account_id AS profile_group_id, name, interface_language, region, avatar_key, is_kids, sort_order, created_by_account_id AS created_by_user_id, created_at, updated_at
        FROM identity.profiles
        WHERE id = $1::uuid AND deleted_at IS NULL
      `,
      [profileId],
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
        SELECT id, account_id AS profile_group_id, name, interface_language, region, avatar_key, is_kids, sort_order, created_by_account_id AS created_by_user_id, created_at, updated_at
        FROM identity.profiles
        WHERE account_id = $1::uuid AND deleted_at IS NULL
        ORDER BY sort_order ASC, created_at ASC
      `,
      [profileGroupId],
    );
    return result.rows.map((row) => mapProfile(row));
  }

  async listAvatarKeysForProfileGroups(client: DbClient, profileGroupIds: string[]): Promise<string[]> {
    if (profileGroupIds.length === 0) {
      return [];
    }

    const result = await client.query(
      `
        SELECT DISTINCT avatar_key
        FROM identity.profiles
        WHERE account_id = ANY($1::uuid[])
          AND deleted_at IS NULL
          AND avatar_key IS NOT NULL
          AND btrim(avatar_key) <> ''
        ORDER BY avatar_key ASC
      `,
      [profileGroupIds],
    );

    return result.rows
      .map((row) => (typeof row.avatar_key === 'string' ? row.avatar_key : null))
      .filter((value): value is string => value !== null);
  }

  async listForOwnerUser(client: DbClient, ownerUserId: string): Promise<ProfileRecord[]> {
    return this.listForProfileGroup(client, ownerUserId);
  }

  async listAll(client: DbClient, limit: number, offset: number): Promise<ProfileRecord[]> {
    const result = await client.query(
      `
        SELECT id, account_id AS profile_group_id, name, interface_language, region, avatar_key, is_kids, sort_order, created_by_account_id AS created_by_user_id, created_at, updated_at
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
        SELECT id, account_id AS profile_group_id, name, interface_language, region, avatar_key, is_kids, sort_order, created_by_account_id AS created_by_user_id, created_at, updated_at
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
    avatarKey?: string | null;
    isKids?: boolean;
    sortOrder: number;
    createdByUserId: string;
  }): Promise<ProfileRecord> {
    const result = await client.query(
      `
        INSERT INTO identity.profiles (account_id, name, interface_language, region, avatar_key, is_kids, sort_order, created_by_account_id)
        VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8::uuid)
        RETURNING id, account_id AS profile_group_id, name, interface_language, region, avatar_key, is_kids, sort_order, created_by_account_id AS created_by_user_id, created_at, updated_at
      `,
      [params.profileGroupId, params.name, normalizeRequiredProfileLanguage(params.interfaceLanguage ?? 'en'), normalizeOptionalProfileRegion(params.region), params.avatarKey ?? null, params.isKids ?? false, params.sortOrder, params.createdByUserId],
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
    avatarKey?: string | null;
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
          avatar_key = $6,
          is_kids = $7,
          sort_order = $8,
          updated_at = now()
        WHERE id = $1::uuid AND account_id = $2::uuid AND deleted_at IS NULL
        RETURNING id, account_id AS profile_group_id, name, interface_language, region, avatar_key, is_kids, sort_order, created_by_account_id AS created_by_user_id, created_at, updated_at
      `,
      [
        params.profileId,
        current.profileGroupId,
        params.name ?? current.name,
        params.interfaceLanguage === undefined ? current.interfaceLanguage : normalizeRequiredProfileLanguage(params.interfaceLanguage),
        params.region === undefined ? current.region : normalizeOptionalProfileRegion(params.region),
        params.avatarKey === undefined ? current.avatarKey : params.avatarKey,
        params.isKids ?? current.isKids,
        params.sortOrder ?? current.sortOrder,
      ],
    );
    return result.rows[0] ? mapProfile(result.rows[0]) : null;
  }
}
