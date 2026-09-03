import type { DbClient } from '../../lib/db.js';

export const ADDON_TYPES = ['stremio', 'jsplugin'] as const;

export type AddonType = (typeof ADDON_TYPES)[number];

export type AddonPayload = {
  providerId?: string;
  name?: string;
  version?: string;
};

export type AddonRecord = {
  id: string;
  account_id: string;
  addon_type: AddonType;
  manifest_url: string;
  payload: AddonPayload;
  created_at: string;
  updated_at: string;
};

const ADDON_COLUMNS = 'id, account_id, addon_type, manifest_url, payload, created_at, updated_at';

export class AddonRepository {
  async listForAccount(client: DbClient, accountId: string): Promise<AddonRecord[]> {
    const result = await client.query<AddonRecord>(
      `
      SELECT ${ADDON_COLUMNS}
      FROM identity.account_addons
      WHERE account_id = $1::uuid
      ORDER BY created_at ASC, id ASC
      `,
      [accountId],
    );
    return result.rows.map(mapPayload);
  }

  async findByKey(
    client: DbClient,
    accountId: string,
    addonType: AddonType,
    manifestUrl: string,
    providerId: string | null,
  ): Promise<AddonRecord | null> {
    const result = await client.query<AddonRecord>(
      `
      SELECT ${ADDON_COLUMNS}
      FROM identity.account_addons
      WHERE account_id = $1::uuid
        AND addon_type = $2
        AND manifest_url = $3
        AND COALESCE(payload->>'providerId', '') = $4
      LIMIT 1
      `,
      [accountId, addonType, manifestUrl, providerId ?? ''],
    );
    return result.rows[0] ? mapPayload(result.rows[0]) : null;
  }

  async insert(
    client: DbClient,
    accountId: string,
    addonType: AddonType,
    manifestUrl: string,
    payload: AddonPayload,
  ): Promise<AddonRecord> {
    const result = await client.query<AddonRecord>(
      `
      INSERT INTO identity.account_addons (account_id, addon_type, manifest_url, payload)
      VALUES ($1::uuid, $2, $3, $4::jsonb)
      RETURNING ${ADDON_COLUMNS}
      `,
      [accountId, addonType, manifestUrl, JSON.stringify(payload)],
    );
    const inserted = result.rows[0];
    if (!inserted) {
      throw new Error('Addon insert did not return a row.');
    }
    return mapPayload(inserted);
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

function mapPayload(row: AddonRecord): AddonRecord {
  return { ...row, payload: row.payload ?? {} };
}
