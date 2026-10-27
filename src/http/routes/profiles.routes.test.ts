import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp, seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

const AUTH_HEADERS = { authorization: 'Bearer test' };

type ProfileLookupEntry = { id: string; accountId: string; isAdmin: boolean; hasPin: boolean };

function makeProfileService(state: { updateCalls: Array<{ authSubject: string; profileId: string }> }) {
  return {
    async listForAccount() { return []; },
    async create() { throw new Error('not used'); },
    async update(authSubject: string, profileId: string, input: Record<string, unknown>) {
      state.updateCalls.push({ authSubject, profileId });
      return {
        id: profileId,
        profileGroupId: authSubject,
        name: String(input.name ?? 'Updated Name'),
        interfaceLanguage: String(input.interfaceLanguage ?? 'en'),
        region: null,
        avatarUrl: null,
        isAdmin: true,
        requirePinToAddProfiles: false,
        hasPin: false,
        isKids: false,
        sortOrder: 0,
        createdByUserId: authSubject,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };
    },
    async delete() { throw new Error('not used'); },
    notifyProfileCreated() {},
  } as never;
}

function makeFakePinService() {
  return {
    async verifyAdminPinForAddProfile() {},
    async setPin() {},
    async changePin() {},
    async removePin() {},
    async verifyPin() { return { valid: true, lockedUntil: null, remainingAttemptsBeforeLockout: 0 }; },
    async lock() {},
    async setRequirePinToAddProfiles() {},
  } as never;
}

function makeLookup(profiles: Record<string, ProfileLookupEntry>) {
  return async (profileId: string, authSubject: string): Promise<ProfileLookupEntry | null> => {
    const entry = profiles[profileId];
    if (!entry) return null;
    return { ...entry, accountId: entry.accountId === 'other-account' ? entry.accountId : authSubject };
  };
}

async function buildProfileApp(state: { updateCalls: Array<{ authSubject: string; profileId: string }> }, profiles: Record<string, ProfileLookupEntry>) {
  const { registerProfileRoutes } = await import('./profiles.js');
  return buildTestApp((app) => registerProfileRoutes(app, {
    profileService: makeProfileService(state),
    pinService: makeFakePinService(),
    adminProfileLookup: makeLookup(profiles),
  }));
}

test('PATCH /v1/profiles/:profileId is rejected when the profile context is not an admin profile', async (t) => {
  const state = { updateCalls: [] as Array<{ authSubject: string; profileId: string }> };
  const app = await buildProfileApp(state, {
    'kid-profile-1': { id: 'kid-profile-1', accountId: 'auth-subject', isAdmin: false, hasPin: false },
  });
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'PATCH',
    url: '/v1/profiles/kid-profile-1',
    headers: { ...AUTH_HEADERS, 'x-profile-id': 'kid-profile-1' },
    payload: { name: 'Renamed Kid' },
  });

  assert.equal(response.statusCode, 403);
  const body = response.json();
  assert.equal(body.error.code, 'admin_profile_required');
  assert.equal(body.error.category, 'authorization');
  assert.equal(state.updateCalls.length, 0, 'the profile must not be updated');
});

test('PATCH /v1/profiles/:profileId succeeds with an admin profile context', async (t) => {
  const state = { updateCalls: [] as Array<{ authSubject: string; profileId: string }> };
  const app = await buildProfileApp(state, {
    'admin-profile-1': { id: 'admin-profile-1', accountId: 'auth-subject', isAdmin: true, hasPin: false },
  });
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'PATCH',
    url: '/v1/profiles/profile-2',
    headers: { ...AUTH_HEADERS, 'x-profile-id': 'admin-profile-1' },
    payload: { name: 'Renamed Profile' },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.profile.name, 'Renamed Profile');
  assert.deepEqual(state.updateCalls, [{ authSubject: 'auth-subject', profileId: 'profile-2' }]);
});

test('PATCH /v1/profiles/:profileId requires a profile context header', async (t) => {
  const state = { updateCalls: [] as Array<{ authSubject: string; profileId: string }> };
  const app = await buildProfileApp(state, {
    'admin-profile-1': { id: 'admin-profile-1', accountId: 'auth-subject', isAdmin: true, hasPin: false },
  });
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'PATCH',
    url: '/v1/profiles/profile-2',
    headers: { ...AUTH_HEADERS },
    payload: { name: 'Renamed Profile' },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, 'profile_context_required');
  assert.equal(state.updateCalls.length, 0, 'the profile must not be updated');
});

test('PATCH /v1/profiles/:profileId is rejected when the profile belongs to another account', async (t) => {
  const state = { updateCalls: [] as Array<{ authSubject: string; profileId: string }> };
  const app = await buildProfileApp(state, {
    'other-profile-1': { id: 'other-profile-1', accountId: 'other-account', isAdmin: true, hasPin: false },
  });
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'PATCH',
    url: '/v1/profiles/other-profile-1',
    headers: { ...AUTH_HEADERS, 'x-profile-id': 'other-profile-1' },
    payload: { name: 'Renamed Profile' },
  });

  assert.equal(response.statusCode, 403);
  assert.equal(state.updateCalls.length, 0, 'the profile must not be updated');
});

test('PATCH /v1/profiles/:profileId allows an admin profile to patch a kid profile', async (t) => {
  const state = { updateCalls: [] as Array<{ authSubject: string; profileId: string }> };
  const app = await buildProfileApp(state, {
    'admin-profile-1': { id: 'admin-profile-1', accountId: 'auth-subject', isAdmin: true, hasPin: false },
    'kid-profile-1': { id: 'kid-profile-1', accountId: 'auth-subject', isAdmin: false, hasPin: false },
  });
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'PATCH',
    url: '/v1/profiles/kid-profile-1',
    headers: { ...AUTH_HEADERS, 'x-profile-id': 'admin-profile-1' },
    payload: { name: 'Renamed Kid' },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(state.updateCalls, [{ authSubject: 'auth-subject', profileId: 'kid-profile-1' }]);
});
