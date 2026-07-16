import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';
import type { ProfilePinRow } from './profile.repo.js';
import type { ProfilePinService, ProfilePinRepo } from './profile-pin.service.js';

seedTestEnv();

const AUTH_SUBJECT = 'auth-1';
const PROFILE_ID = 'profile-1';
const ADMIN_PROFILE_ID = 'admin-1';

const noopClient: unknown = {};

function runner<T>(work: (client: unknown) => Promise<T>): Promise<T> {
  return work(noopClient);
}

interface FakeRepoState {
  pinRows: Map<string, ProfilePinRow>;
  ownerMap: Map<string, string>;
  admins: Map<string, { id: string; requirePinToAddProfiles: boolean; hasPin: boolean }>;
  updates: Array<{ profileId: string; params: { pinHash: string | null; failedAttempts: number; lockedUntil: string | null } }>;
  requireUpdates: Array<{ profileId: string; ownerUserId: string; value: boolean }>;
}

function freshRepo(): { repo: ProfilePinRepo; state: FakeRepoState } {
  const state: FakeRepoState = {
    pinRows: new Map(),
    ownerMap: new Map([
      [`${AUTH_SUBJECT}::${PROFILE_ID}`, PROFILE_ID],
      [`${AUTH_SUBJECT}::${ADMIN_PROFILE_ID}`, ADMIN_PROFILE_ID],
    ]),
    admins: new Map(),
    updates: [],
    requireUpdates: [],
  };
  const repo: ProfilePinRepo = {
    async findByIdForOwnerUser(_client, profileId, ownerUserId) {
      const key = `${ownerUserId}::${profileId}`;
      return state.ownerMap.get(key) ? { id: profileId } : null;
    },
    async findPinRow(_client, profileId) {
      return state.pinRows.get(profileId) ?? null;
    },
    async findAdminProfileForOwner(_client, ownerUserId) {
      const admin = state.admins.get(ownerUserId);
      return admin ?? null;
    },
    async updatePin(_client, profileId, params) {
      state.updates.push({ profileId, params });
      const existing = state.pinRows.get(profileId) ?? {
        profileId,
        pinHash: null,
        failedAttempts: 0,
        lockedUntil: null,
        requirePinToAddProfiles: false,
      };
      state.pinRows.set(profileId, { ...existing, ...params });
    },
    async setRequirePinToAddProfiles(_client, adminProfileId, ownerUserId, value) {
      state.requireUpdates.push({ profileId: adminProfileId, ownerUserId, value });
      if (!state.ownerMap.get(`${ownerUserId}::${adminProfileId}`)) return null;
      return { id: adminProfileId };
    },
  };
  return { repo, state };
}

async function buildService(repo: ProfilePinRepo): Promise<ProfilePinService> {
  const { ProfilePinService: Service } = await import('./profile-pin.service.js');
  return new Service(repo, 4, runner);
}

const MAX_ATTEMPTS = 5;

test('setPin stores bcrypt hash and clears failed-attempt state', async () => {
  const { repo, state } = freshRepo();
  const service = await buildService(repo);
  await service.setPin(AUTH_SUBJECT, PROFILE_ID, '1234');
  const row = state.pinRows.get(PROFILE_ID);
  assert.ok(row && row.pinHash && row.pinHash.length >= 20, 'hash should be persisted');
  assert.equal(row.failedAttempts, 0);
  assert.equal(row.lockedUntil, null);
  assert.equal(state.updates.length, 1);
  assert.equal(state.updates[0]?.params.pinHash, row.pinHash ?? null);
});

test('setPin rejects malformed PIN (non-4-digit)', async () => {
  const { repo } = freshRepo();
  const service = await buildService(repo);
  await assert.rejects(
    () => service.setPin(AUTH_SUBJECT, PROFILE_ID, '12'),
    (err: { statusCode?: number }) => err.statusCode === 400,
  );
  await assert.rejects(
    () => service.setPin(AUTH_SUBJECT, PROFILE_ID, 'abcd'),
    (err: { statusCode?: number }) => err.statusCode === 400,
  );
  await assert.rejects(
    () => service.setPin(AUTH_SUBJECT, PROFILE_ID, 1234 as unknown),
    (err: { statusCode?: number }) => err.statusCode === 400,
  );
});

test('changePin succeeds when current PIN matches', async () => {
  const { repo, state } = freshRepo();
  const seededService = await buildService(repo);
  await seededService.setPin(AUTH_SUBJECT, PROFILE_ID, '1111');
  const seeded = state.pinRows.get(PROFILE_ID)?.pinHash;
  assert.ok(seeded);

  const service = await buildService(repo);
  await service.changePin(AUTH_SUBJECT, PROFILE_ID, '1111', '2222');
  const after = state.pinRows.get(PROFILE_ID);
  assert.ok(after && after.pinHash && after.pinHash !== seeded);
  assert.equal(after.failedAttempts, 0);
});

test('changePin increments failed attempts on wrong current PIN', async () => {
  const { repo, state } = freshRepo();
  const service = await buildService(repo);
  await service.setPin(AUTH_SUBJECT, PROFILE_ID, '1111');
  await assert.rejects(
    () => service.changePin(AUTH_SUBJECT, PROFILE_ID, '0000', '2222'),
    (err: { statusCode?: number }) => err.statusCode === 403,
  );
  const after = state.pinRows.get(PROFILE_ID);
  assert.equal(after?.failedAttempts, 1);
  assert.equal(after?.lockedUntil, null);
});

test('changePin fails with 409 if no PIN set', async () => {
  const { repo } = freshRepo();
  const service = await buildService(repo);
  await assert.rejects(
    () => service.changePin(AUTH_SUBJECT, PROFILE_ID, '1111', '2222'),
    (err: { statusCode?: number }) => err.statusCode === 409,
  );
});

test('verifyPin returns ok short-circuit when no PIN is set', async () => {
  const { repo } = freshRepo();
  const service = await buildService(repo);
  const result = await service.verifyPin(PROFILE_ID, '0000');
  assert.deepEqual(result, { valid: true, lockedUntil: null });
});

test('verifyPin locks out after threshold of wrong attempts', async () => {
  const { repo, state } = freshRepo();
  const service = await buildService(repo);
  await service.setPin(AUTH_SUBJECT, PROFILE_ID, '1234');

  for (let i = 1; i <= MAX_ATTEMPTS + 1; i++) {
    const result = await service.verifyPin(PROFILE_ID, '0000');
    assert.equal(result.valid, false, `attempt ${i} should fail`);
    if (i <= MAX_ATTEMPTS) {
      assert.equal(result.lockedUntil, null, `attempt ${i} should not yet lock out`);
    } else {
      assert.ok(result.lockedUntil, `attempt ${i} should produce a lockedUntil`);
      assert.equal(result.remainingAttemptsBeforeLockout, 0);
    }
  }

  const finalRow = state.pinRows.get(PROFILE_ID);
  assert.ok(finalRow && finalRow.lockedUntil, 'lockout timestamp persisted');
});

test('verifyPin reports locked-until when called during lockout window', async () => {
  const { repo, state } = freshRepo();
  const future = new Date(Date.now() + 60_000).toISOString();
  state.pinRows.set(PROFILE_ID, {
    profileId: PROFILE_ID,
    pinHash: '$2a$04$abcdefghijklmnopqrstuv',
    failedAttempts: MAX_ATTEMPTS + 1,
    lockedUntil: future,
    requirePinToAddProfiles: false,
  });
  const service = await buildService(repo);
  const result = await service.verifyPin(PROFILE_ID, '1234');
  assert.equal(result.valid, false);
  assert.equal(result.lockedUntil, future);
  assert.equal(result.remainingAttemptsBeforeLockout, 0);
});

test('verifyPin succeeds and resets counter on correct PIN', async () => {
  const { repo, state } = freshRepo();
  const service = await buildService(repo);
  await service.setPin(AUTH_SUBJECT, PROFILE_ID, '1111');
  const existing = state.pinRows.get(PROFILE_ID);
  assert.ok(existing);
  state.pinRows.set(PROFILE_ID, {
    ...existing,
    failedAttempts: 3,
    lockedUntil: null,
  });
  const result = await service.verifyPin(PROFILE_ID, '1111');
  assert.deepEqual(result, { valid: true, lockedUntil: null });
  assert.equal(state.pinRows.get(PROFILE_ID)?.failedAttempts, 0);
});

test('removePin clears stored hash when current PIN matches', async () => {
  const { repo, state } = freshRepo();
  await buildService(repo).then((s) => s.setPin(AUTH_SUBJECT, PROFILE_ID, '9999'));
  const service = await buildService(repo);
  await service.removePin(AUTH_SUBJECT, PROFILE_ID, '9999');
  assert.equal(state.pinRows.get(PROFILE_ID)?.pinHash, null);
  assert.equal(state.pinRows.get(PROFILE_ID)?.failedAttempts, 0);
});

test('removePin is a no-op when no PIN is set', async () => {
  const { repo, state } = freshRepo();
  await buildService(repo).then((s) => s.removePin(AUTH_SUBJECT, PROFILE_ID, '9999'));
  assert.equal(state.pinRows.has(PROFILE_ID), false);
});

test('setRequirePinToAddProfiles writes the flag', async () => {
  const { repo, state } = freshRepo();
  state.ownerMap.set(`${AUTH_SUBJECT}::${ADMIN_PROFILE_ID}`, ADMIN_PROFILE_ID);
  const service = await buildService(repo);
  await service.setRequirePinToAddProfiles(AUTH_SUBJECT, ADMIN_PROFILE_ID, true);
  assert.deepEqual(state.requireUpdates, [{ profileId: ADMIN_PROFILE_ID, ownerUserId: AUTH_SUBJECT, value: true }]);
});

test('setRequirePinToAddProfiles 404s when admin profile not owned', async () => {
  const { repo } = freshRepo();
  const service = await buildService(repo);
  await assert.rejects(
    () => service.setRequirePinToAddProfiles(AUTH_SUBJECT, 'unknown', true),
    (err: { statusCode?: number }) => err.statusCode === 404,
  );
});

test('verifyAdminPinForAddProfile passes through when policy disabled', async () => {
  const { repo, state } = freshRepo();
  state.admins.set(AUTH_SUBJECT, { id: ADMIN_PROFILE_ID, requirePinToAddProfiles: false, hasPin: false });
  const service = await buildService(repo);
  await service.verifyAdminPinForAddProfile(AUTH_SUBJECT, '0000');
  assert.equal(state.pinRows.size, 0);
});

test('verifyAdminPinForAddProfile rejects when policy enabled but no PIN set', async () => {
  const { repo, state } = freshRepo();
  state.admins.set(AUTH_SUBJECT, { id: ADMIN_PROFILE_ID, requirePinToAddProfiles: true, hasPin: false });
  const service = await buildService(repo);
  await assert.rejects(
    () => service.verifyAdminPinForAddProfile(AUTH_SUBJECT, '0000'),
    (err: { statusCode?: number }) => err.statusCode === 409,
  );
});

test('verifyAdminPinForAddProfile verifies admin PIN when policy enabled', async () => {
  const { repo, state } = freshRepo();
  const seeded = await buildService(repo);
  await seeded.setPin(AUTH_SUBJECT, ADMIN_PROFILE_ID, '4321');
  state.admins.set(AUTH_SUBJECT, {
    id: ADMIN_PROFILE_ID,
    requirePinToAddProfiles: true,
    hasPin: true,
  });
  const service = await buildService(repo);
  await service.verifyAdminPinForAddProfile(AUTH_SUBJECT, '4321');
  await assert.rejects(
    () => service.verifyAdminPinForAddProfile(AUTH_SUBJECT, '0000'),
    (err: { statusCode?: number }) => err.statusCode === 403,
  );
});
