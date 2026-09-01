import type { DbClient } from '../../lib/db.js';

export type AddonRecord = {
  id: string;
  account_id: string;
  manifest_url: string;
  created_at: string;
  updated_at: string;
};

export class AddonRepository {
  async listForAccount(client: DbClient, accountId: string): Promise<AddonRecord[]> {
    const result = await client.query<AddonRecord>(
      `
      SELECT id, account_id, manifest_url, created_at, updated_at
      FROM identity.account_addons
      WHERE account_id = $1::uuid
      ORDER BY created_at ASC, id ASC
      `,
      [accountId],
    );
    return result.rows;
  }

  async findByManifestUrl(
    client: DbClient,
    accountId: string,
    manifestUrl: string,
  ): Promise<AddonRecord | null> {
    const result = await client.query<AddonRecord>(
      `
      SELECT id, account_id, manifest_url, created_at, updated_at
      FROM identity.account_addons
      WHERE account_id = $1::uuid AND manifest_url = $2
      LIMIT 1
      `,
      [accountId, manifestUrl],
    );
    return result.rows[0] ?? null;
  }

  async insert(
    client: DbClient,
    accountId: string,
    manifestUrl: string,
  ): Promise<AddonRecord> {
    const result = await client.query<AddonRecord>(
      `
      INSERT INTO identity.account_addons (account_id, manifest_url)
      VALUES ($1::uuid, $2)
      RETURNING id, account_id, manifest_url, created_at, updated_at
      `,
      [accountId, manifestUrl],
    );
    const inserted = result.rows[0];
    if (!inserted) {
      throw new Error('Addon insert did not return a row.');
    }
    return inserted;
  }

  async deleteById(
    client: DbClient,
    accountId: string,
    addonId: string,
  ): Promise<boolean> {
    const result = await client.query(
      `
      DELETE FROM identity.account_addons
      WHERE id = $1::uuid AND account_id = $2::uuid
      RETURNING id
      `,
      [addonId, accountId],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
