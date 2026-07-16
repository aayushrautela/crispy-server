import bcrypt from 'bcryptjs';
import { HttpError } from '../../lib/errors.js';
import { withDbClient } from '../../lib/db.js';
import { ProfileRepository, type ProfilePinRow } from './profile.repo.js';

const DEFAULT_PIN_COST = 10;
const PIN_PATTERN = /^\d{4}$/;

const LOCKOUT_WINDOWS_MS: readonly number[] = [
  30_000,
  300_000,
  1_800_000,
  3_600_000,
];

const MAX_ATTEMPTS_BEFORE_LOCKOUT = 5;

export type PinVerifyResult =
  | { valid: true; lockedUntil: null }
  | { valid: false; lockedUntil: string | null; remainingAttemptsBeforeLockout: number };

export interface ProfilePinRepo {
  findByIdForOwnerUser(client: unknown, profileId: string, ownerUserId: string): Promise<{ id: string } | null>;
  findPinRow(client: unknown, profileId: string): Promise<ProfilePinRow | null>;
  findAdminProfileForOwner(client: unknown, ownerUserId: string): Promise<{ id: string; requirePinToAddProfiles: boolean; hasPin: boolean } | null>;
  updatePin(client: unknown, profileId: string, params: { pinHash: string | null; failedAttempts: number; lockedUntil: string | null }): Promise<void>;
  setRequirePinToAddProfiles(client: unknown, adminProfileId: string, ownerUserId: string, value: boolean): Promise<unknown | null>;
}

type DbRunner<T> = (work: (client: unknown) => Promise<T>) => Promise<T>;

function normalizePin(value: unknown): string {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'PIN must be a 4-digit string.');
  }
  const trimmed = value.trim();
  if (!PIN_PATTERN.test(trimmed)) {
    throw new HttpError(400, 'PIN must be exactly 4 digits.');
  }
  return trimmed;
}

function computeLockoutUntil(failedAttemptsAboveThreshold: number, now: Date): string | null {
  if (failedAttemptsAboveThreshold <= 0) return null;
  const index = Math.min(failedAttemptsAboveThreshold - 1, LOCKOUT_WINDOWS_MS.length - 1);
  const ms = LOCKOUT_WINDOWS_MS[index];
  if (ms === undefined) return null;
  return new Date(now.getTime() + ms).toISOString();
}

function parseIso(value: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

export class ProfilePinService {
  private readonly runner: DbRunner<unknown>;

  constructor(
    private readonly repo: ProfilePinRepo = new ProfileRepository(),
    private readonly pinCost: number = DEFAULT_PIN_COST,
    runner?: DbRunner<unknown>,
  ) {
    this.runner = runner ?? ((work) => withDbClient((client) => work(client) as Promise<unknown>));
  }

  async setPin(authSubject: string, profileId: string, newPin: unknown): Promise<void> {
    const pin = normalizePin(newPin);
    const profile = await this.requireOwnedProfile(authSubject, profileId);
    const hash = await bcrypt.hash(pin, this.pinCost);
    await this.run((client) => this.repo.updatePin(client, profile.id, {
      pinHash: hash,
      failedAttempts: 0,
      lockedUntil: null,
    }));
  }

  async changePin(authSubject: string, profileId: string, currentPin: unknown, newPin: unknown): Promise<void> {
    const pin = normalizePin(newPin);
    const profile = await this.requireOwnedProfile(authSubject, profileId);
    const pinRow = await this.run((client) => this.repo.findPinRow(client, profile.id));
    if (!pinRow || !pinRow.pinHash) {
      throw new HttpError(409, 'No PIN is set on this profile.');
    }
    await this.assertNotLocked(pinRow);
    const matches = await bcrypt.compare(normalizePin(currentPin), pinRow.pinHash);
    if (!matches) {
      await this.registerFailedAttempt(profile.id, pinRow);
      throw new HttpError(403, 'Current PIN is incorrect.');
    }
    const hash = await bcrypt.hash(pin, this.pinCost);
    await this.run((client) => this.repo.updatePin(client, profile.id, {
      pinHash: hash,
      failedAttempts: 0,
      lockedUntil: null,
    }));
  }

  async removePin(authSubject: string, profileId: string, currentPin: unknown): Promise<void> {
    const profile = await this.requireOwnedProfile(authSubject, profileId);
    const pinRow = await this.run((client) => this.repo.findPinRow(client, profile.id));
    if (!pinRow || !pinRow.pinHash) {
      return;
    }
    await this.assertNotLocked(pinRow);
    const matches = await bcrypt.compare(normalizePin(currentPin), pinRow.pinHash);
    if (!matches) {
      await this.registerFailedAttempt(profile.id, pinRow);
      throw new HttpError(403, 'Current PIN is incorrect.');
    }
    await this.run((client) => this.repo.updatePin(client, profile.id, {
      pinHash: null,
      failedAttempts: 0,
      lockedUntil: null,
    }));
  }

  async verifyPin(profileId: string, pin: unknown): Promise<PinVerifyResult> {
    const pinRow = await this.run((client) => this.repo.findPinRow(client, profileId));
    if (!pinRow || !pinRow.pinHash) {
      return { valid: true, lockedUntil: null };
    }
    const lockedUntilMs = parseIso(pinRow.lockedUntil);
    const now = Date.now();
    if (lockedUntilMs && lockedUntilMs > now) {
      return { valid: false, lockedUntil: pinRow.lockedUntil, remainingAttemptsBeforeLockout: 0 };
    }
    const matches = await bcrypt.compare(normalizePin(pin), pinRow.pinHash);
    if (matches) {
      await this.run((client) => this.repo.updatePin(client, profileId, {
        pinHash: pinRow.pinHash,
        failedAttempts: 0,
        lockedUntil: null,
      }));
      return { valid: true, lockedUntil: null };
    }
    const nextFailedAttempts = pinRow.failedAttempts + 1;
    const aboveThreshold = Math.max(nextFailedAttempts - MAX_ATTEMPTS_BEFORE_LOCKOUT, 0);
    const nextLockedUntil = computeLockoutUntil(aboveThreshold, new Date(now));
    await this.run((client) => this.repo.updatePin(client, profileId, {
      pinHash: pinRow.pinHash,
      failedAttempts: nextFailedAttempts,
      lockedUntil: nextLockedUntil,
    }));
    const remaining = Math.max(MAX_ATTEMPTS_BEFORE_LOCKOUT - nextFailedAttempts, 0);
    return { valid: false, lockedUntil: nextLockedUntil, remainingAttemptsBeforeLockout: remaining };
  }

  async setRequirePinToAddProfiles(authSubject: string, adminProfileId: string, value: boolean): Promise<void> {
    const updated = await this.run((client) => this.repo.setRequirePinToAddProfiles(client, adminProfileId, authSubject, value));
    if (!updated) {
      throw new HttpError(404, 'Admin profile not found for this account.');
    }
  }

  async verifyAdminPinForAddProfile(authSubject: string, adminPin: unknown): Promise<void> {
    const admin = await this.run((client) => this.repo.findAdminProfileForOwner(client, authSubject));
    if (!admin) {
      throw new HttpError(404, 'Admin profile not found for this account.');
    }
    if (!admin.requirePinToAddProfiles) {
      return;
    }
    if (!admin.hasPin) {
      throw new HttpError(409, 'Admin PIN is required to add profiles but no admin PIN is set.');
    }
    const result = await this.verifyPin(admin.id, adminPin);
    if (!result.valid) {
      throw new HttpError(403, 'Admin PIN is required to add a new profile.', { lockedUntil: result.lockedUntil });
    }
  }

  private async assertNotLocked(pinRow: { lockedUntil: string | null }): Promise<void> {
    const lockedUntilMs = parseIso(pinRow.lockedUntil);
    if (lockedUntilMs && lockedUntilMs > Date.now()) {
      throw new HttpError(423, 'PIN verification is temporarily locked. Try again later.', {
        lockedUntil: pinRow.lockedUntil,
      });
    }
  }

  private async registerFailedAttempt(profileId: string, pinRow: { failedAttempts: number; pinHash: string | null; lockedUntil: string | null }): Promise<void> {
    const nextFailedAttempts = pinRow.failedAttempts + 1;
    const aboveThreshold = Math.max(nextFailedAttempts - MAX_ATTEMPTS_BEFORE_LOCKOUT, 0);
    const nextLockedUntil = computeLockoutUntil(aboveThreshold, new Date());
    await this.run((client) => this.repo.updatePin(client, profileId, {
      pinHash: pinRow.pinHash,
      failedAttempts: nextFailedAttempts,
      lockedUntil: nextLockedUntil,
    }));
  }

  private async requireOwnedProfile(authSubject: string, profileId: string): Promise<{ id: string }> {
    const profile = await this.run((client) => this.repo.findByIdForOwnerUser(client, profileId, authSubject));
    if (!profile) {
      throw new HttpError(404, 'Profile not found.');
    }
    return { id: profile.id };
  }

  private async run<T>(work: (client: unknown) => Promise<T>): Promise<T> {
    return this.runner(work) as Promise<T>;
  }
}
