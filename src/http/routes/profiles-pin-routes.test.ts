import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp, seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

const AUTH_HEADERS = { authorization: 'Bearer test' };
const VALID_PROFILE_BODY = {
  name: 'Kid One',
  interfaceLanguage: 'en',
  region: 'US',
};

function makeFakePinService(overrides: Partial<{
  adminProfile: { hasPin: boolean; requirePinToAddProfiles: boolean };
  throwOnVerifyAdminWith?: 'lockout' | 'wrong' | 'none';
  verifyCount: number;
}> = {}) {
  const state: { verifyCount: number } = { verifyCount: 0 };
  return {
    state,
    service: {
      async verifyAdminPinForAddProfile(_auth: string, _pin: unknown) {
        state.verifyCount++;
        if (!overrides.adminProfile) return;
        const { hasPin, requirePinToAddProfiles } = overrides.adminProfile;
        if (!requirePinToAddProfiles) return;
        if (!hasPin) {
          throw Object.assign(new Error('Admin PIN is required.'), { statusCode: 409 });
        }
        if (overrides.throwOnVerifyAdminWith === 'wrong') {
          throw Object.assign(new Error('Wrong admin PIN.'), { statusCode: 403 });
        }
      },
      async setPin() {},
      async changePin() {},
      async removePin() {},
      async verifyPin() { return { valid: true, lockedUntil: null }; },
      async setRequirePinToAddProfiles() {},
    } as never,
  };
}

test('POST /v1/profiles does NOT call verifyAdminPinForAddProfile when no adminPin is supplied', async (t) => {
  const { ProfileLocalService } = await import('../../modules/profiles/profile-local.service.js');
  const original = ProfileLocalService.prototype.create;
  t.after(() => { ProfileLocalService.prototype.create = original; });
  let observedAdminPin = 'not-called';
  ProfileLocalService.prototype.create = async function (authSubject: string, input: Record<string, unknown>) {
    observedAdminPin = 'never-resolved';
    return {
      id: 'profile-1',
      profileGroupId: authSubject,
      name: String(input.name),
      interfaceLanguage: String(input.interfaceLanguage),
      region: input.region === null || typeof input.region === 'string' ? input.region as string | null : null,
      avatarUrl: typeof input.avatarKey === 'string' ? input.avatarKey : null,
      isAdmin: false,
      requirePinToAddProfiles: false,
      hasPin: false,
      isKids: Boolean(input.isKids),
      sortOrder: Number(input.sortOrder ?? 0),
      createdByUserId: authSubject,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
  };

  const fakePin = makeFakePinService();
  const { registerProfileRoutes } = await import('./profiles.js');
  const app = await buildTestApp((a) => registerProfileRoutes(a, { profileService: new ProfileLocalService(), pinService: fakePin.service }));
  t.after(async () => { await app.close(); });
  const response = await app.inject({
    method: 'POST',
    url: '/v1/profiles',
    headers: AUTH_HEADERS,
    payload: VALID_PROFILE_BODY,
  });
  assert.equal(response.statusCode, 200);
  assert.equal(fakePin.state.verifyCount, 0);
  assert.equal(observedAdminPin, 'never-resolved');
});

test('POST /v1/profiles calls verifyAdminPinForAddProfile when adminPin is supplied', async (t) => {
  const { ProfileLocalService } = await import('../../modules/profiles/profile-local.service.js');
  const original = ProfileLocalService.prototype.create;
  t.after(() => { ProfileLocalService.prototype.create = original; });
  ProfileLocalService.prototype.create = async function (authSubject: string, input: Record<string, unknown>) {
    return {
      id: 'profile-1',
      profileGroupId: authSubject,
      name: String(input.name),
      interfaceLanguage: String(input.interfaceLanguage),
      region: null,
      avatarUrl: null,
      isAdmin: false,
      requirePinToAddProfiles: false,
      hasPin: false,
      isKids: false,
      sortOrder: 0,
      createdByUserId: authSubject,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
  };

  const fakePin = makeFakePinService({ adminProfile: { hasPin: true, requirePinToAddProfiles: true } });
  const { registerProfileRoutes } = await import('./profiles.js');
  const app = await buildTestApp((a) => registerProfileRoutes(a, { profileService: new ProfileLocalService(), pinService: fakePin.service }));
  t.after(async () => { await app.close(); });
  const response = await app.inject({
    method: 'POST',
    url: '/v1/profiles',
    headers: AUTH_HEADERS,
    payload: { ...VALID_PROFILE_BODY, adminPin: '1234' },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(fakePin.state.verifyCount, 1);
});

test('POST /v1/profiles rejects with 403 when admin PIN is wrong and policy is on', async (t) => {
  const { ProfileLocalService } = await import('../../modules/profiles/profile-local.service.js');
  const original = ProfileLocalService.prototype.create;
  t.after(() => { ProfileLocalService.prototype.create = original; });
  let createCalled = 0;
  ProfileLocalService.prototype.create = async function () {
    createCalled++;
    throw new Error('Should not be called');
  };

  const fakePin = makeFakePinService({
    adminProfile: { hasPin: true, requirePinToAddProfiles: true },
    throwOnVerifyAdminWith: 'wrong',
  });
  const { registerProfileRoutes } = await import('./profiles.js');
  const app = await buildTestApp((a) => registerProfileRoutes(a, { profileService: new ProfileLocalService(), pinService: fakePin.service }));
  t.after(async () => { await app.close(); });
  const response = await app.inject({
    method: 'POST',
    url: '/v1/profiles',
    headers: AUTH_HEADERS,
    payload: { ...VALID_PROFILE_BODY, adminPin: '0000' },
  });
  assert.equal(response.statusCode, 403);
  assert.equal(createCalled, 0);
});

test('PATCH /v1/profiles/:profileId/admin-policy rejects non-admin profiles with 403', async (t) => {
  const { ProfileLocalService } = await import('../../modules/profiles/profile-local.service.js');
  const original = ProfileLocalService.prototype.requireOwnedProfile;
  t.after(() => { ProfileLocalService.prototype.requireOwnedProfile = original; });
  ProfileLocalService.prototype.requireOwnedProfile = async function (_auth: string, id: string) {
    return {
      id, profileGroupId: 'g', name: 'Member', interfaceLanguage: 'en', region: null,
      avatarUrl: null, isAdmin: false, requirePinToAddProfiles: false, hasPin: false,
      isKids: false, sortOrder: 1, createdByUserId: 'u',
      createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
    };
  };

  const fakePin = makeFakePinService();
  const { registerProfileRoutes } = await import('./profiles.js');
  const app = await buildTestApp((a) => registerProfileRoutes(a, { profileService: new ProfileLocalService(), pinService: fakePin.service }));
  t.after(async () => { await app.close(); });
  const response = await app.inject({
    method: 'PATCH',
    url: '/v1/profiles/profile-2/admin-policy',
    headers: AUTH_HEADERS,
    payload: { requirePinToAddProfiles: true },
  });
  assert.equal(response.statusCode, 403);
});
