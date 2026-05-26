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
        SELECT account_id AS profile_group_id, 'owner' AS role
        FROM identity.accounts
        WHERE id = $1::uuid AND deleted_at IS NULL
      `,
      [userId],
    );

    return result.rows.map((row) => ({
      profileGroupId: String(row.profile_group_id),
      role: String(row.role),
    }));
  }

  async createDefaultProfileGroup(client: DbClient, params: { userId: string; profileGroupName: string }): Promise<string> {
    await client.query('SELECT identity.upsert_account($1::uuid, null, $2)', [params.userId, params.profileGroupName]);
    return params.userId;
  }

  async findOwnedProfileGroupIds(client: DbClient, userId: string): Promise<string[]> {
    const result = await client.query(
      `
        SELECT id
        FROM identity.accounts
        WHERE id = $1::uuid AND deleted_at IS NULL
      `,
      [userId],
    );

    return result.rows.map((row) => String(row.id));
  }

  async listMembers(client: DbClient, profileGroupId: string): Promise<ProfileGroupMemberRow[]> {
    const result = await client.query(
      `
        SELECT account_id AS user_id, role
        FROM identity.profile_members
        WHERE account_id = $1::uuid
        ORDER BY created_at ASC
      `,
      [profileGroupId],
    );

    return result.rows.map((row) => ({
      userId: String(row.user_id),
      role: String(row.role),
    }));
  }

  async transferOwnership(_client: DbClient, _params: { profileGroupId: string; nextOwnerUserId: string }): Promise<void> {}

  async deleteById(client: DbClient, profileGroupId: string): Promise<boolean> {
    const result = await client.query(
      `
        DELETE FROM identity.accounts
        WHERE id = $1::uuid AND deleted_at IS NULL
      `,
      [profileGroupId],
    );

    return (result.rowCount ?? 0) > 0;
  }

  async deleteOwnedByUser(client: DbClient, userId: string): Promise<number> {
    const deleted = await this.deleteById(client, userId);
    return deleted ? 1 : 0;
  }
}
