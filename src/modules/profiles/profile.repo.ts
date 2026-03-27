import type { DbClient } from '../../lib/db.js';
import { requireDbIsoString } from '../../lib/time.js';

export type ProfileRecord = {
  id: string;
  profileGroupId: string;
  name: string;
  avatarKey: string | null;
  isKids: boolean;
  sortOrder: number;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

function mapProfile(row: Record<string, unknown>): ProfileRecord {
  return {
    id: String(row.id),
    profileGroupId: String(row.profile_group_id),
    name: String(row.name),
    avatarKey: typeof row.avatar_key === 'string' ? row.avatar_key : null,
    isKids: Boolean(row.is_kids),
    sortOrder: Number(row.sort_order),
    createdByUserId: typeof row.created_by_user_id === 'string' ? row.created_by_user_id : null,
    createdAt: requireDbIsoString(row.created_at as Date | string | null | undefined, 'profiles.created_at'),
    updatedAt: requireDbIsoString(row.updated_at as Date | string | null | undefined, 'profiles.updated_at'),
  };
}

export class ProfileRepository {
  async findById(client: DbClient, profileId: string): Promise<ProfileRecord | null> {
    const result = await client.query(
      `
        SELECT id, profile_group_id, name, avatar_key, is_kids, sort_order, created_by_user_id, created_at, updated_at
        FROM profiles
        WHERE id = $1::uuid
      `,
      [profileId],
    );
    return result.rows[0] ? mapProfile(result.rows[0]) : null;
  }

  async findOwnerUserIdById(client: DbClient, profileId: string): Promise<string | null> {
    const result = await client.query(
      `
        SELECT pg.owner_user_id
        FROM profiles p
        INNER JOIN profile_groups pg ON pg.id = p.profile_group_id
        WHERE p.id = $1::uuid
      `,
      [profileId],
    );

    return typeof result.rows[0]?.owner_user_id === 'string' ? result.rows[0].owner_user_id : null;
  }

  async listForProfileGroup(client: DbClient, profileGroupId: string): Promise<ProfileRecord[]> {
    const result = await client.query(
      `
        SELECT id, profile_group_id, name, avatar_key, is_kids, sort_order, created_by_user_id, created_at, updated_at
        FROM profiles
        WHERE profile_group_id = $1::uuid
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
        FROM profiles
        WHERE profile_group_id = ANY($1::uuid[])
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
    const result = await client.query(
      `
        SELECT p.id, p.profile_group_id, p.name, p.avatar_key, p.is_kids, p.sort_order,
               p.created_by_user_id, p.created_at, p.updated_at
        FROM profiles p
        INNER JOIN profile_groups pg ON pg.id = p.profile_group_id
        WHERE pg.owner_user_id = $1::uuid
        ORDER BY p.sort_order ASC, p.created_at ASC
      `,
      [ownerUserId],
    );
    return result.rows.map((row) => mapProfile(row));
  }

  async listAll(client: DbClient, limit: number, offset: number): Promise<ProfileRecord[]> {
    const result = await client.query(
      `
        SELECT id, profile_group_id, name, avatar_key, is_kids, sort_order, created_by_user_id, created_at, updated_at
        FROM profiles
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
        SELECT p.id, p.profile_group_id, p.name, p.avatar_key, p.is_kids, p.sort_order, p.created_by_user_id, p.created_at, p.updated_at
        FROM profiles p
        INNER JOIN profile_groups pg ON pg.id = p.profile_group_id
        WHERE p.id = $1::uuid AND pg.owner_user_id = $2::uuid
      `,
      [profileId, ownerUserId],
    );
    return result.rows[0] ? mapProfile(result.rows[0]) : null;
  }

  async create(client: DbClient, params: {
    profileGroupId: string;
    name: string;
    avatarKey?: string | null;
    isKids?: boolean;
    sortOrder: number;
    createdByUserId: string;
  }): Promise<ProfileRecord> {
    const result = await client.query(
      `
        INSERT INTO profiles (profile_group_id, name, avatar_key, is_kids, sort_order, created_by_user_id)
        VALUES ($1::uuid, $2, $3, $4, $5, $6::uuid)
        RETURNING id, profile_group_id, name, avatar_key, is_kids, sort_order, created_by_user_id, created_at, updated_at
      `,
      [params.profileGroupId, params.name, params.avatarKey ?? null, params.isKids ?? false, params.sortOrder, params.createdByUserId],
    );
    return mapProfile(result.rows[0]);
  }

  async update(client: DbClient, params: {
    profileId: string;
    ownerUserId: string;
    name?: string;
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
        UPDATE profiles
        SET
          name = $3,
          avatar_key = $4,
          is_kids = $5,
          sort_order = $6,
          updated_at = now()
        WHERE id = $1::uuid AND profile_group_id = $2::uuid
        RETURNING id, profile_group_id, name, avatar_key, is_kids, sort_order, created_by_user_id, created_at, updated_at
      `,
      [
        params.profileId,
        current.profileGroupId,
        params.name ?? current.name,
        params.avatarKey === undefined ? current.avatarKey : params.avatarKey,
        params.isKids ?? current.isKids,
        params.sortOrder ?? current.sortOrder,
      ],
    );
    return result.rows[0] ? mapProfile(result.rows[0]) : null;
  }
}
