import type { DbClient } from '../../lib/db.js';

export type HouseholdMembershipRow = {
  householdId: string;
  role: string;
};

export type HouseholdMemberRow = {
  userId: string;
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

  async findOwnedHouseholdIds(client: DbClient, userId: string): Promise<string[]> {
    const result = await client.query(
      `
        SELECT id
        FROM households
        WHERE owner_user_id = $1::uuid
        ORDER BY created_at ASC
      `,
      [userId],
    );

    return result.rows.map((row) => String(row.id));
  }

  async listMembers(client: DbClient, householdId: string): Promise<HouseholdMemberRow[]> {
    const result = await client.query(
      `
        SELECT user_id, role
        FROM household_members
        WHERE household_id = $1::uuid
        ORDER BY created_at ASC
      `,
      [householdId],
    );

    return result.rows.map((row) => ({
      userId: String(row.user_id),
      role: String(row.role),
    }));
  }

  async transferOwnership(client: DbClient, params: { householdId: string; nextOwnerUserId: string }): Promise<void> {
    await client.query(
      `
        UPDATE households
        SET owner_user_id = $2::uuid,
            updated_at = now()
        WHERE id = $1::uuid
      `,
      [params.householdId, params.nextOwnerUserId],
    );

    await client.query(
      `
        UPDATE household_members
        SET role = 'owner'
        WHERE household_id = $1::uuid AND user_id = $2::uuid
      `,
      [params.householdId, params.nextOwnerUserId],
    );
  }

  async deleteById(client: DbClient, householdId: string): Promise<boolean> {
    const result = await client.query(
      `
        DELETE FROM households
        WHERE id = $1::uuid
      `,
      [householdId],
    );

    return (result.rowCount ?? 0) > 0;
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
