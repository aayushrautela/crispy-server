import { randomBytes, randomInt } from 'node:crypto';
import { env } from '../../config/env.js';
import { withDbClient, withTransaction } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import type { AuthScope } from './auth.types.js';
import { PAT_DEFAULT_SCOPES } from './auth.types.js';
import { PersonalAccessTokenRepository } from './personal-access-token.repo.js';
import { hashAccessToken } from './token-hash.js';
import { DeviceAuthorizationRepository } from './device-authorization.repo.js';
import { DeviceRepository } from './devices.repo.js';

// RFC 8628 §6.1 base-20 charset: uppercase A-Z without vowels, so codes are
// easy to type on mobile keyboards and never form random words.
const USER_CODE_CHARSET = 'BCDFGHJKLMNPQRSTVWXZ';
const USER_CODE_LENGTH = 8;
const DEVICE_CODE_PREFIX = 'cp_dvc_';
const TOKEN_PREFIX = 'cp_pat_';
const DEVICE_CODE_TTL_MS = 15 * 60 * 1000;
const POLL_INTERVAL_SECONDS = 5;
const APP_SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;

// RFC 8628 §5.1: user codes have low entropy, so brute-force resistance lives
// in rate limiting on the verification side rather than in code length.
const VERIFICATION_ATTEMPT_LIMIT = 5;
const VERIFICATION_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const AUTHORIZATION_CREATE_LIMIT = 10;
const AUTHORIZATION_CREATE_WINDOW_MS = 5 * 60 * 1000;

export const DEVICE_AUTHORIZATION_CLIENT_IDS = ['crispy-tv'] as const;
export type DeviceAuthorizationClientId = typeof DEVICE_AUTHORIZATION_CLIENT_IDS[number];

export type DeviceAuthorizationView = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
};

export type DeviceTokenPollResult =
  | { kind: 'authorization_pending' }
  | { kind: 'slow_down'; interval: number }
  | { kind: 'access_denied' }
  | { kind: 'expired_token' }
  | {
      kind: 'approved';
      plaintextToken: string;
      deviceId: string;
      token: {
        id: string;
        name: string;
        tokenPreview: string;
        scopes: AuthScope[];
        expiresAt: string | null;
        createdAt: string;
      };
      user: {
        id: string;
        email: string | null;
      };
    };

export type PendingDeviceAuthorizationView = {
  clientId: string;
  deviceName: string | null;
  expiresAt: string;
  deviceId: string | null;
};

export type DeviceListItem = {
  id: string;
  clientId: string;
  deviceName: string | null;
  deviceType: 'tv' | 'mobile' | 'web' | 'desktop';
  lastSeenAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  activeTokenPreview: string | null;
};

type AttemptWindow = { count: number; windowStart: number };

export function generateUserCode(): string {
  const chars: string[] = [];
  for (let i = 0; i < USER_CODE_LENGTH; i += 1) {
    chars.push(USER_CODE_CHARSET[randomInt(0, USER_CODE_CHARSET.length)] as string);
  }
  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
}

export function normalizeUserCode(input: string): string {
  // RFC 8628 §6.1: uppercase, strip dashes/punctuation/spaces the user may
  // have added, and ignore anything outside the expected character set.
  const stripped = input.toUpperCase().replace(/[^A-Z]/g, '');
  if (stripped.length !== USER_CODE_LENGTH) {
    throw new HttpError(400, 'Invalid verification code format.', undefined, 'invalid_user_code');
  }
  return `${stripped.slice(0, 4)}-${stripped.slice(4)}`;
}

export class DeviceAuthorizationService {
  constructor(
    private readonly repo: DeviceAuthorizationRepository = new DeviceAuthorizationRepository(),
    private readonly tokenRepo: PersonalAccessTokenRepository = new PersonalAccessTokenRepository(),
    private readonly deviceRepo: DeviceRepository = new DeviceRepository(),
  ) {}

  private verificationAttempts = new Map<string, AttemptWindow>();
  private authorizationCreates = new Map<string, AttemptWindow>();

  async createAuthorization(input: { clientId: string; deviceName?: string | null; deviceId?: string | null; ip?: string | null }): Promise<DeviceAuthorizationView> {
    const clientId = normalizeClientId(input.clientId);
    const deviceName = normalizeDeviceName(input.deviceName);
    // Untrusted echo of a previously issued device id. Validation (ownership,
    // revocation) happens against the approving account at approval time.
    const claimedDeviceId = normalizeDeviceId(input.deviceId);
    if (input.ip) {
      this.assertWithinWindow(this.authorizationCreates, input.ip, AUTHORIZATION_CREATE_LIMIT, AUTHORIZATION_CREATE_WINDOW_MS, 429, 'Too many device authorization requests. Try again later.', 'device_authorization_rate_limited');
      this.recordFailedAttempt(this.authorizationCreates, input.ip, AUTHORIZATION_CREATE_WINDOW_MS);
    }

    const plaintextDeviceCode = `${DEVICE_CODE_PREFIX}${randomBytes(32).toString('base64url')}`;
    const expiresAt = new Date(Date.now() + DEVICE_CODE_TTL_MS).toISOString();

    // Retry on the (unlikely) user-code collision with an active row.
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const userCode = generateUserCode();
      try {
        await withDbClient((client) => this.repo.create(client, {
          clientId,
          deviceName,
          claimedDeviceId,
          deviceCodeHash: hashAccessToken(plaintextDeviceCode),
          deviceCodePreview: plaintextDeviceCode.slice(0, 12),
          userCode,
          intervalSeconds: POLL_INTERVAL_SECONDS,
          expiresAt,
        }));

        const verificationUri = env.deviceVerificationUrl;
        return {
          deviceCode: plaintextDeviceCode,
          userCode,
          verificationUri,
          verificationUriComplete: `${verificationUri}?user_code=${encodeURIComponent(userCode)}`,
          expiresIn: Math.round(DEVICE_CODE_TTL_MS / 1000),
          interval: POLL_INTERVAL_SECONDS,
        };
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error ? lastError : new HttpError(500, 'Failed to create device authorization.', undefined, 'device_authorization_failed');
  }

  async poll(input: { deviceCode: string }): Promise<DeviceTokenPollResult> {
    const deviceCode = input.deviceCode.trim();
    if (!deviceCode.startsWith(DEVICE_CODE_PREFIX)) {
      return { kind: 'expired_token' };
    }
    const deviceCodeHash = hashAccessToken(deviceCode);

    return withDbClient(async (client) => {
      const record = await this.repo.findByDeviceCodeHash(client, deviceCodeHash);
      if (!record) {
        return { kind: 'expired_token' };
      }

      // Enforce the server-side poll interval (RFC 8628 §3.5): a client that
      // polls too fast gets slow_down and the interval grows by 5 seconds.
      const lastPolledMs = record.lastPolledAt ? Date.parse(record.lastPolledAt) : null;
      if (lastPolledMs !== null && Date.now() - lastPolledMs < record.intervalSeconds * 1000) {
        const interval = await this.repo.bumpPollInterval(client, record.id);
        return { kind: 'slow_down', interval };
      }
      await this.repo.touchLastPolled(client, record.id);

      if (record.status === 'denied') {
        return { kind: 'access_denied' };
      }
      if (record.status === 'pending') {
        return { kind: 'authorization_pending' };
      }

      // 'approved' → atomically consume and mint the token. 'consumed' means
      // the device code was already exchanged (single use) → expired_token.
      return withTransaction(async (txClient) => {
        const consumed = await this.repo.consumeApprovedByDeviceCodeHash(txClient, deviceCodeHash);
        if (!consumed || !consumed.accountId || !consumed.deviceId) {
          return { kind: 'expired_token' };
        }

        const plaintextToken = `${TOKEN_PREFIX}${randomBytes(24).toString('base64url')}`;
        const token = await this.tokenRepo.create(txClient, {
          userId: consumed.accountId,
          name: record.deviceName ? `TV session: ${record.deviceName}` : 'TV session',
          tokenHash: hashAccessToken(plaintextToken),
          tokenPreview: plaintextToken.slice(0, 12),
          scopes: PAT_DEFAULT_SCOPES,
          expiresAt: new Date(Date.now() + APP_SESSION_TTL_MS).toISOString(),
          deviceId: consumed.deviceId,
        });

        await this.deviceRepo.touchLastSeen(txClient, consumed.deviceId);

        const emailResult = await txClient.query('SELECT email FROM identity.accounts WHERE id = $1::uuid', [consumed.accountId]);

        return {
          kind: 'approved' as const,
          plaintextToken,
          deviceId: consumed.deviceId,
          token: {
            id: token.id,
            name: token.name,
            tokenPreview: token.tokenPreview,
            scopes: token.scopes,
            expiresAt: token.expiresAt,
            createdAt: token.createdAt,
          },
          user: {
            id: consumed.accountId,
            email: emailResult.rows[0]?.email ?? null,
          },
        };
      });
    });
  }

  async lookupForApproval(userId: string, input: { userCode: string }): Promise<PendingDeviceAuthorizationView> {
    this.assertWithinWindow(this.verificationAttempts, userId, VERIFICATION_ATTEMPT_LIMIT, VERIFICATION_ATTEMPT_WINDOW_MS, 429, 'Too many invalid verification attempts. Try again later.', 'user_code_rate_limited');

    const userCode = normalizeUserCode(input.userCode);
    const record = await withDbClient((client) => this.repo.findByUserCode(client, userCode));
    if (!record) {
      this.recordFailedAttempt(this.verificationAttempts, userId, VERIFICATION_ATTEMPT_WINDOW_MS);
      throw new HttpError(400, 'Verification code is invalid or expired.', undefined, 'invalid_user_code');
    }

    return {
      clientId: record.clientId,
      deviceName: record.deviceName,
      expiresAt: record.expiresAt,
      deviceId: null,
    };
  }

  async approve(userId: string, input: { userCode: string }): Promise<PendingDeviceAuthorizationView> {
    const userCode = normalizeUserCode(input.userCode);
    const approved = await withTransaction(async (txClient) => {
      const approvedRow = await this.repo.approveByUserCode(txClient, userCode, userId);
      if (!approvedRow) return null;

      // Resolve the device identity: reuse the TV's claimed device row when
      // it belongs to this account and is still active, otherwise mint a new
      // one. This keeps re-logins from duplicating devices in the list.
      const existing = approvedRow.claimedDeviceId
        ? await this.deviceRepo.findById(txClient, approvedRow.claimedDeviceId)
        : null;
      const reusable = existing && existing.accountId === userId && !existing.revokedAt ? existing : null;
      const device = reusable
        ? await this.deviceRepo.refresh(txClient, {
            deviceId: reusable.id,
            accountId: userId,
            deviceName: approvedRow.deviceName,
          })
        : await this.deviceRepo.create(txClient, {
            accountId: userId,
            clientId: approvedRow.clientId,
            deviceName: approvedRow.deviceName,
          });
      if (!device) {
        throw new HttpError(500, 'Failed to register device.', undefined, 'device_registration_failed');
      }

      await this.repo.bindDevice(txClient, {
        id: approvedRow.id,
        deviceId: device.id,
      });

      return { view: {
        clientId: approvedRow.clientId,
        deviceName: approvedRow.deviceName,
        expiresAt: approvedRow.expiresAt,
        deviceId: device.id,
      } };
    });

    if (!approved) {
      throw new HttpError(409, 'Verification code is invalid, expired, or already used.', undefined, 'user_code_not_usable');
    }
    this.verificationAttempts.delete(userId);
    return approved.view;
  }

  async deny(input: { userCode: string }): Promise<PendingDeviceAuthorizationView> {
    const userCode = normalizeUserCode(input.userCode);
    const denied = await withDbClient((client) => this.repo.denyByUserCode(client, userCode));
    if (!denied) {
      throw new HttpError(409, 'Verification code is invalid, expired, or already used.', undefined, 'user_code_not_usable');
    }
    return {
      clientId: denied.clientId,
      deviceName: denied.deviceName,
      expiresAt: denied.expiresAt,
      deviceId: null,
    };
  }

  async listDevices(userId: string): Promise<DeviceListItem[]> {
    return withDbClient((client) => this.deviceRepo.listForAccountWithActiveToken(client, userId));
  }

  async revokeDevice(userId: string, input: { deviceId: string }): Promise<void> {
    await withTransaction(async (txClient) => {
      const revoked = await this.deviceRepo.revoke(txClient, {
        deviceId: input.deviceId,
        accountId: userId,
      });
      if (!revoked) {
        throw new HttpError(404, 'Device not found or already revoked.', undefined, 'device_not_found');
      }
      await this.tokenRepo.revokeForDevice(txClient, {
        accountId: userId,
        deviceId: input.deviceId,
      });
    });
  }

  private assertWithinWindow(
    store: Map<string, AttemptWindow>,
    key: string,
    limit: number,
    windowMs: number,
    statusCode: number,
    message: string,
    code: string,
  ): void {
    const now = Date.now();
    const window = store.get(key);
    if (!window || now - window.windowStart > windowMs) return;
    if (window.count >= limit) {
      throw new HttpError(statusCode, message, undefined, code);
    }
  }

  private recordFailedAttempt(store: Map<string, AttemptWindow>, key: string, windowMs: number): void {
    const now = Date.now();
    const window = store.get(key);
    if (!window || now - window.windowStart > windowMs) {
      store.set(key, { count: 1, windowStart: now });
      return;
    }
    window.count += 1;
  }
}

function normalizeClientId(value: string): DeviceAuthorizationClientId {
  const trimmed = value.trim();
  if (!DEVICE_AUTHORIZATION_CLIENT_IDS.includes(trimmed as DeviceAuthorizationClientId)) {
    throw new HttpError(400, 'Unknown client ID.', undefined, 'invalid_client_id');
  }
  return trimmed as DeviceAuthorizationClientId;
}

function normalizeDeviceName(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 80);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeDeviceId(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && UUID_PATTERN.test(trimmed) ? trimmed.toLowerCase() : null;
}
