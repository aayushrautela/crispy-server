import type { DbClient } from '../../lib/db.js';

export type ProfileRecord = {
  id: string;
  householdId: string;
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
    householdId: String(row.household_id),
    name: String(row.name),
    avatarKey: typeof row.avatar_key === 'string' ? row.avatar_key : null,
    isKids: Boolean(row.is_kids),
    sortOrder: Number(row.sort_order),
    createdByUserId: typeof row.created_by_user_id === 'string' ? row.created_by_user_id : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class ProfileRepository {
  async listForHousehold(client: DbClient, householdId: string): Promise<ProfileRecord[]> {
    const result = await client.query(
      `
        SELECT id, household_id, name, avatar_key, is_kids, sort_order, created_by_user_id, created_at, updated_at
        FROM profiles
        WHERE household_id = $1::uuid
        ORDER BY sort_order ASC, created_at ASC
      `,
      [householdId],
    );
    return result.rows.map((row) => mapProfile(row));
  }

  async findByIdForUser(client: DbClient, profileId: string, userId: string): Promise<ProfileRecord | null> {
    const result = await client.query(
      `
        SELECT p.id, p.household_id, p.name, p.avatar_key, p.is_kids, p.sort_order, p.created_by_user_id, p.created_at, p.updated_at
        FROM profiles p
        INNER JOIN household_members hm ON hm.household_id = p.household_id
        WHERE p.id = $1::uuid AND hm.user_id = $2::uuid
      `,
      [profileId, userId],
    );
    return result.rows[0] ? mapProfile(result.rows[0]) : null;
  }

  async create(client: DbClient, params: {
    householdId: string;
    name: string;
    avatarKey?: string | null;
    isKids?: boolean;
    sortOrder: number;
    createdByUserId: string;
  }): Promise<ProfileRecord> {
    const result = await client.query(
      `
        INSERT INTO profiles (household_id, name, avatar_key, is_kids, sort_order, created_by_user_id)
        VALUES ($1::uuid, $2, $3, $4, $5, $6::uuid)
        RETURNING id, household_id, name, avatar_key, is_kids, sort_order, created_by_user_id, created_at, updated_at
      `,
      [params.householdId, params.name, params.avatarKey ?? null, params.isKids ?? false, params.sortOrder, params.createdByUserId],
    );
    return mapProfile(result.rows[0]);
  }

  async update(client: DbClient, params: {
    profileId: string;
    userId: string;
    name?: string;
    avatarKey?: string | null;
    isKids?: boolean;
    sortOrder?: number;
  }): Promise<ProfileRecord | null> {
    const current = await this.findByIdForUser(client, params.profileId, params.userId);
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
        WHERE id = $1::uuid AND household_id = $2::uuid
        RETURNING id, household_id, name, avatar_key, is_kids, sort_order, created_by_user_id, created_at, updated_at
      `,
      [
        params.profileId,
        current.householdId,
        params.name ?? current.name,
        params.avatarKey === undefined ? current.avatarKey : params.avatarKey,
        params.isKids ?? current.isKids,
        params.sortOrder ?? current.sortOrder,
      ],
    );
    return result.rows[0] ? mapProfile(result.rows[0]) : null;
  }
}
