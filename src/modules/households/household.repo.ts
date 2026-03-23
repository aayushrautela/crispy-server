import type { DbClient } from '../../lib/db.js';

export type HouseholdMembershipRow = {
  householdId: string;
  role: string;
};

export class HouseholdRepository {
  async findMembershipsForUser(client: DbClient, userId: string): Promise<HouseholdMembershipRow[]> {
    const result = await client.query(
      `
        SELECT household_id, role
        FROM household_members
        WHERE user_id = $1::uuid
        ORDER BY created_at ASC
      `,
      [userId],
    );

    return result.rows.map((row) => ({
      householdId: String(row.household_id),
      role: String(row.role),
    }));
  }

  async createDefaultHousehold(client: DbClient, params: { userId: string; householdName: string }): Promise<string> {
    const householdResult = await client.query(
      `
        INSERT INTO households (name, owner_user_id)
        VALUES ($1, $2::uuid)
        RETURNING id
      `,
      [params.householdName, params.userId],
    );
    const householdId = String(householdResult.rows[0].id);

    await client.query(
      `
        INSERT INTO household_members (household_id, user_id, role)
        VALUES ($1::uuid, $2::uuid, 'owner')
      `,
      [householdId, params.userId],
    );

    return householdId;
  }

  async deleteOwnedByUser(client: DbClient, userId: string): Promise<number> {
    const result = await client.query(
      `
        DELETE FROM households
        WHERE owner_user_id = $1::uuid
      `,
      [userId],
    );

    return result.rowCount ?? 0;
  }
}
