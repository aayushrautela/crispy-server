import type { DbClient } from '../../lib/db.js';
import { requireDbIsoString, toDbIsoString } from '../../lib/time.js';

export type DeviceRecord = {
  id: string;
  accountId: string;
  clientId: string;
  deviceName: string | null;
  deviceType: 'tv' | 'mobile' | 'web' | 'desktop';
  lastSeenAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DeviceType = DeviceRecord['deviceType'];

function mapDevice(row: Record<string, unknown>): DeviceRecord {
  const deviceType = String(row.device_type);
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    clientId: String(row.client_id),
    deviceName: row.device_name == null ? null : String(row.device_name),
    deviceType: (deviceType === 'mobile' || deviceType === 'web' || deviceType === 'desktop' ? deviceType : 'tv') as DeviceType,
    lastSeenAt: toDbIsoString(row.last_seen_at as Date | string | null | undefined, 'devices.last_seen_at'),
    revokedAt: toDbIsoString(row.revoked_at as Date | string | null | undefined, 'devices.revoked_at'),
    createdAt: requireDbIsoString(row.created_at as Date | string | null | undefined, 'devices.created_at'),
    updatedAt: requireDbIsoString(row.updated_at as Date | string | null | undefined, 'devices.updated_at'),
  };
}

const COLUMNS = 'id, account_id, client_id, device_name, device_type, last_seen_at, revoked_at, created_at, updated_at';

export class DeviceRepository {
  async create(client: DbClient, params: {
    accountId: string;
    clientId: string;
    deviceName: string | null;
    deviceType?: DeviceType;
  }): Promise<DeviceRecord> {
    const result = await client.query(
      `
        INSERT INTO private.devices (account_id, client_id, device_name, device_type, last_seen_at)
        VALUES ($1::uuid, $2, $3, $4, now())
        RETURNING ${COLUMNS}
      `,
      [params.accountId, params.clientId, params.deviceName, params.deviceType ?? 'tv'],
    );

    return mapDevice(result.rows[0]);
  }

  /**
   * Re-login path: refresh an existing device row instead of creating a
   * duplicate. Only unrevoked devices owned by the same account may be
   * reused; anything else falls back to creating a fresh device.
   */
  async refresh(client: DbClient, params: {
    deviceId: string;
    accountId: string;
    deviceName: string | null;
  }): Promise<DeviceRecord | null> {
    const result = await client.query(
      `
        UPDATE private.devices
        SET device_name = COALESCE($3, device_name),
            last_seen_at = now(),
            updated_at = now()
        WHERE id = $1::uuid
          AND account_id = $2::uuid
          AND revoked_at IS NULL
        RETURNING ${COLUMNS}
      `,
      [params.deviceId, params.accountId, params.deviceName],
    );

    return result.rows[0] ? mapDevice(result.rows[0]) : null;
  }

  async findById(client: DbClient, deviceId: string): Promise<DeviceRecord | null> {
    const result = await client.query(
      `
        SELECT ${COLUMNS}
        FROM private.devices
        WHERE id = $1::uuid
      `,
      [deviceId],
    );

    return result.rows[0] ? mapDevice(result.rows[0]) : null;
  }

  async listForAccount(client: DbClient, accountId: string): Promise<DeviceRecord[]> {
    const result = await client.query(
      `
        SELECT ${COLUMNS}
        FROM private.devices
        WHERE account_id = $1::uuid
        ORDER BY created_at DESC
      `,
      [accountId],
    );

    return result.rows.map((row) => mapDevice(row));
  }

  async revoke(client: DbClient, params: {
    deviceId: string;
    accountId: string;
  }): Promise<DeviceRecord | null> {
    const result = await client.query(
      `
        UPDATE private.devices
        SET revoked_at = now(), updated_at = now()
        WHERE id = $1::uuid
          AND account_id = $2::uuid
          AND revoked_at IS NULL
        RETURNING ${COLUMNS}
      `,
      [params.deviceId, params.accountId],
    );

    return result.rows[0] ? mapDevice(result.rows[0]) : null;
  }

  async touchLastSeen(client: DbClient, deviceId: string): Promise<void> {
    await client.query(
      `
        UPDATE private.devices
        SET last_seen_at = now(), updated_at = now()
        WHERE id = $1::uuid
      `,
      [deviceId],
    );
  }

  async setAuthorizationDevice(client: DbClient, params: {
    authorizationId: string;
    deviceId: string;
  }): Promise<void> {
    await client.query(
      `
        UPDATE private.device_authorization_codes
        SET device_id = $2::uuid, updated_at = now()
        WHERE id = $1::uuid
      `,
      [params.authorizationId, params.deviceId],
    );
  }

  async listForAccountWithActiveToken(client: DbClient, accountId: string): Promise<Array<DeviceRecord & { activeTokenPreview: string | null }>> {
    const result = await client.query(
      `
        SELECT d.id, d.account_id, d.client_id, d.device_name, d.device_type,
               d.last_seen_at, d.revoked_at, d.created_at, d.updated_at,
               t.token_preview AS active_token_preview
        FROM private.devices d
        LEFT JOIN LATERAL (
          SELECT token_preview
          FROM private.personal_access_tokens
          WHERE device_id = d.id
            AND revoked_at IS NULL
            AND (expires_at IS NULL OR expires_at > now())
          ORDER BY created_at DESC
          LIMIT 1
        ) t ON true
        WHERE d.account_id = $1::uuid
        ORDER BY d.created_at DESC
      `,
      [accountId],
    );

    return result.rows.map((row) => ({
      ...mapDevice(row),
      activeTokenPreview: row.active_token_preview == null ? null : String(row.active_token_preview),
    }));
  }
}
