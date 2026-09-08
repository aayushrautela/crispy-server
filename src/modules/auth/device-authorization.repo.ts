import type { DbClient } from '../../lib/db.js';
import { requireDbIsoString, toDbIsoString } from '../../lib/time.js';

export type DeviceAuthorizationRecord = {
  id: string;
  clientId: string;
  deviceName: string | null;
  deviceCodeHash: string;
  deviceCodePreview: string;
  userCode: string;
  claimedDeviceId: string | null;
  deviceId: string | null;
  intervalSeconds: number;
  lastPolledAt: string | null;
  status: 'pending' | 'approved' | 'denied' | 'consumed';
  accountId: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
};

function mapDeviceAuthorization(row: Record<string, unknown>): DeviceAuthorizationRecord {
  const status = String(row.status);
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    deviceName: row.device_name == null ? null : String(row.device_name),
    deviceCodeHash: String(row.device_code_hash),
    deviceCodePreview: String(row.device_code_preview),
    userCode: String(row.user_code),
    claimedDeviceId: row.claimed_device_id == null ? null : String(row.claimed_device_id),
    deviceId: row.device_id == null ? null : String(row.device_id),
    intervalSeconds: Number(row.interval_seconds),
    lastPolledAt: toDbIsoString(row.last_polled_at as Date | string | null | undefined, 'device_authorization_codes.last_polled_at'),
    status: (status === 'approved' || status === 'denied' || status === 'consumed' ? status : 'pending') as DeviceAuthorizationRecord['status'],
    accountId: row.account_id ? String(row.account_id) : null,
    expiresAt: requireDbIsoString(row.expires_at as Date | string | null | undefined, 'device_authorization_codes.expires_at'),
    createdAt: requireDbIsoString(row.created_at as Date | string | null | undefined, 'device_authorization_codes.created_at'),
    updatedAt: requireDbIsoString(row.updated_at as Date | string | null | undefined, 'device_authorization_codes.updated_at'),
  };
}

const COLUMNS = `
  id, client_id, device_name, device_code_hash, device_code_preview, user_code,
  claimed_device_id, device_id, interval_seconds, last_polled_at, status, account_id,
  expires_at, created_at, updated_at
`;

export class DeviceAuthorizationRepository {
  async create(client: DbClient, params: {
    clientId: string;
    deviceName: string | null;
    claimedDeviceId: string | null;
    deviceCodeHash: string;
    deviceCodePreview: string;
    userCode: string;
    intervalSeconds: number;
    expiresAt: string;
  }): Promise<DeviceAuthorizationRecord> {
    const result = await client.query(
      `
        INSERT INTO private.device_authorization_codes (
          client_id,
          device_name,
          claimed_device_id,
          device_code_hash,
          device_code_preview,
          user_code,
          interval_seconds,
          expires_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::int, $8::timestamptz)
        RETURNING ${COLUMNS}
      `,
      [params.clientId, params.deviceName, params.claimedDeviceId, params.deviceCodeHash, params.deviceCodePreview, params.userCode, params.intervalSeconds, params.expiresAt],
    );

    return mapDeviceAuthorization(result.rows[0]);
  }

  async findByDeviceCodeHash(client: DbClient, deviceCodeHash: string): Promise<DeviceAuthorizationRecord | null> {
    const result = await client.query(
      `
        SELECT ${COLUMNS}
        FROM private.device_authorization_codes
        WHERE device_code_hash = $1
          AND expires_at > now()
      `,
      [deviceCodeHash],
    );

    return result.rows[0] ? mapDeviceAuthorization(result.rows[0]) : null;
  }

  async findByUserCode(client: DbClient, userCode: string): Promise<DeviceAuthorizationRecord | null> {
    const result = await client.query(
      `
        SELECT ${COLUMNS}
        FROM private.device_authorization_codes
        WHERE user_code = $1
          AND status = 'pending'
          AND expires_at > now()
      `,
      [userCode],
    );

    return result.rows[0] ? mapDeviceAuthorization(result.rows[0]) : null;
  }

  async touchLastPolled(client: DbClient, id: string): Promise<void> {
    await client.query(
      `
        UPDATE private.device_authorization_codes
        SET last_polled_at = now(), updated_at = now()
        WHERE id = $1::uuid
      `,
      [id],
    );
  }

  async bumpPollInterval(client: DbClient, id: string): Promise<number> {
    const result = await client.query(
      `
        UPDATE private.device_authorization_codes
        SET interval_seconds = interval_seconds + 5, updated_at = now()
        WHERE id = $1::uuid
        RETURNING interval_seconds
      `,
      [id],
    );

    return Number(result.rows[0]?.interval_seconds ?? 5);
  }

  async approveByUserCode(client: DbClient, userCode: string, accountId: string): Promise<DeviceAuthorizationRecord | null> {
    const result = await client.query(
      `
        UPDATE private.device_authorization_codes
        SET status = 'approved', account_id = $2::uuid, approved_at = now(), updated_at = now()
        WHERE user_code = $1
          AND status = 'pending'
          AND expires_at > now()
        RETURNING ${COLUMNS}
      `,
      [userCode, accountId],
    );

    return result.rows[0] ? mapDeviceAuthorization(result.rows[0]) : null;
  }

  async denyByUserCode(client: DbClient, userCode: string): Promise<DeviceAuthorizationRecord | null> {
    const result = await client.query(
      `
        UPDATE private.device_authorization_codes
        SET status = 'denied', denied_at = now(), updated_at = now()
        WHERE user_code = $1
          AND status = 'pending'
          AND expires_at > now()
        RETURNING ${COLUMNS}
      `,
      [userCode],
    );

    return result.rows[0] ? mapDeviceAuthorization(result.rows[0]) : null;
  }

  async consumeApprovedByDeviceCodeHash(client: DbClient, deviceCodeHash: string): Promise<DeviceAuthorizationRecord | null> {
    const result = await client.query(
      `
        UPDATE private.device_authorization_codes
        SET status = 'consumed', consumed_at = now(), updated_at = now()
        WHERE device_code_hash = $1
          AND status = 'approved'
          AND expires_at > now()
        RETURNING ${COLUMNS}
      `,
      [deviceCodeHash],
    );

    return result.rows[0] ? mapDeviceAuthorization(result.rows[0]) : null;
  }

  async bindDevice(client: DbClient, params: {
    id: string;
    deviceId: string;
  }): Promise<void> {
    await client.query(
      `
        UPDATE private.device_authorization_codes
        SET device_id = $2::uuid, updated_at = now()
        WHERE id = $1::uuid
      `,
      [params.id, params.deviceId],
    );
  }
}
