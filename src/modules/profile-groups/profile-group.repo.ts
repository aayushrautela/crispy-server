import type { DbClient } from '../../lib/db.js';

export type ProfileGroupMembershipRow = {
  profileGroupId: string;
  role: string;
};

export type ProfileGroupMemberRow = {
  userId: string;
  role: string;
};

export class ProfileGroupRepository {
  async findMembershipsForUser(client: DbClient, userId: string): Promise<ProfileGroupMembershipRow[]> {
    const result = await client.query(
      `
        SELECT profile_group_id, role
        FROM profile_group_members
        WHERE user_id = $1::uuid
        ORDER BY created_at ASC
      `,
      [userId],
    );

    return result.rows.map((row) => ({
      profileGroupId: String(row.profile_group_id),
      role: String(row.role),
    }));
  }

  async createDefaultProfileGroup(client: DbClient, params: { userId: string; profileGroupName: string }): Promise<string> {
    const profileGroupResult = await client.query(
      `
        INSERT INTO profile_groups (name, owner_user_id)
        VALUES ($1, $2::uuid)
        RETURNING id
      `,
      [params.profileGroupName, params.userId],
    );
    const profileGroupId = String(profileGroupResult.rows[0].id);

    await client.query(
      `
        INSERT INTO profile_group_members (profile_group_id, user_id, role)
        VALUES ($1::uuid, $2::uuid, 'owner')
      `,
      [profileGroupId, params.userId],
    );

    return profileGroupId;
  }

  async findOwnedProfileGroupIds(client: DbClient, userId: string): Promise<string[]> {
    const result = await client.query(
      `
        SELECT id
        FROM profile_groups
        WHERE owner_user_id = $1::uuid
        ORDER BY created_at ASC
      `,
      [userId],
    );

    return result.rows.map((row) => String(row.id));
  }

  async listMembers(client: DbClient, profileGroupId: string): Promise<ProfileGroupMemberRow[]> {
    const result = await client.query(
      `
        SELECT user_id, role
        FROM profile_group_members
        WHERE profile_group_id = $1::uuid
        ORDER BY created_at ASC
      `,
      [profileGroupId],
    );

    return result.rows.map((row) => ({
      userId: String(row.user_id),
      role: String(row.role),
    }));
  }

  async transferOwnership(client: DbClient, params: { profileGroupId: string; nextOwnerUserId: string }): Promise<void> {
    await client.query(
      `
        UPDATE profile_groups
        SET owner_user_id = $2::uuid,
            updated_at = now()
        WHERE id = $1::uuid
      `,
      [params.profileGroupId, params.nextOwnerUserId],
    );

    await client.query(
      `
        UPDATE profile_group_members
        SET role = 'owner'
        WHERE profile_group_id = $1::uuid AND user_id = $2::uuid
      `,
      [params.profileGroupId, params.nextOwnerUserId],
    );
  }

  async deleteById(client: DbClient, profileGroupId: string): Promise<boolean> {
    const result = await client.query(
      `
        DELETE FROM profile_groups
        WHERE id = $1::uuid
      `,
      [profileGroupId],
    );

    return (result.rowCount ?? 0) > 0;
  }

  async deleteOwnedByUser(client: DbClient, userId: string): Promise<number> {
    const result = await client.query(
      `
        DELETE FROM profile_groups
        WHERE owner_user_id = $1::uuid
      `,
      [userId],
    );

    return result.rowCount ?? 0;
  }
}
