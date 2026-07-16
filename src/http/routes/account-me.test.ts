import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from '../../lib/errors.js';
import { buildTestApp, seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

test('account settings route returns account settings envelope', async (t) => {
  const { AccountSettingsService } = await import('../../modules/users/account-settings.service.js');
  const { FeatureEntitlementService } = await import('../../modules/entitlements/feature-entitlement.service.js');
  const originals = {
    getSettings: AccountSettingsService.prototype.getSettings,
    getPricingTierForUser: AccountSettingsService.prototype.getPricingTierForUser,
    getMetadataClientSettingsForUser: FeatureEntitlementService.prototype.getMetadataClientSettingsForUser,
  };

  t.after(() => {
    AccountSettingsService.prototype.getSettings = originals.getSettings;
    AccountSettingsService.prototype.getPricingTierForUser = originals.getPricingTierForUser;
    FeatureEntitlementService.prototype.getMetadataClientSettingsForUser = originals.getMetadataClientSettingsForUser;
  });

  AccountSettingsService.prototype.getSettings = async function () {
    return { metadata: { language: 'en-US' } } as never;
  };
  AccountSettingsService.prototype.getPricingTierForUser = async function () {
    return 'free' as never;
  };
  FeatureEntitlementService.prototype.getMetadataClientSettingsForUser = async function () {
    return { hasMdbListAccess: true };
  };

  const { registerAccountRoutes } = await import('./account.js');
  const app = await buildTestApp((app) => registerAccountRoutes(app, { accountSettingsService: new AccountSettingsService() }));
  t.after(async () => { await app.close(); });

  const response = await app.inject({ method: 'GET', url: '/v1/account/settings', headers: { authorization: 'Bearer test' } });
  assert.equal(response.statusCode, 200);

  const payload = response.json() as { data: { settings: Record<string, any> } };
  assert.equal(payload.data.settings.metadata.language, 'en-US');
  assert.equal(payload.data.settings.metadata.hasMdbListAccess, true);
  assert.equal(payload.data.settings.pricingTier, 'free');
});

test('account settings patch route returns merged settings envelope', async (t) => {
  const { AccountSettingsService } = await import('../../modules/users/account-settings.service.js');
  const { FeatureEntitlementService } = await import('../../modules/entitlements/feature-entitlement.service.js');
  const originals = {
    patchSettings: AccountSettingsService.prototype.patchSettings,
    getPricingTierForUser: AccountSettingsService.prototype.getPricingTierForUser,
    getMetadataClientSettingsForUser: FeatureEntitlementService.prototype.getMetadataClientSettingsForUser,
  };

  t.after(() => {
    AccountSettingsService.prototype.patchSettings = originals.patchSettings;
    AccountSettingsService.prototype.getPricingTierForUser = originals.getPricingTierForUser;
    FeatureEntitlementService.prototype.getMetadataClientSettingsForUser = originals.getMetadataClientSettingsForUser;
  });

  AccountSettingsService.prototype.patchSettings = async function (_userId, patch) {
    return patch as never;
  };
  AccountSettingsService.prototype.getPricingTierForUser = async function () {
    return 'pro' as never;
  };
  FeatureEntitlementService.prototype.getMetadataClientSettingsForUser = async function () {
    return { hasMdbListAccess: false };
  };

  const { registerAccountRoutes } = await import('./account.js');
  const app = await buildTestApp((app) => registerAccountRoutes(app, { accountSettingsService: new AccountSettingsService() }));
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'PATCH',
    url: '/v1/account/settings',
    headers: { authorization: 'Bearer test' },
    payload: { metadata: { language: 'fr-FR' } },
  });
  assert.equal(response.statusCode, 200);

  const payload = response.json() as { data: { settings: Record<string, any> } };
  assert.equal(payload.data.settings.metadata.language, 'fr-FR');
  assert.equal(payload.data.settings.metadata.hasMdbListAccess, false);
  assert.equal(payload.data.settings.pricingTier, 'pro');
});

test('account MDBList secret routes return metadata and delegate to account settings service', async (t) => {
  const { AccountSettingsService } = await import('../../modules/users/account-settings.service.js');
  const originals = {
    getMdbListApiKeyMetadataForUser: AccountSettingsService.prototype.getMdbListApiKeyMetadataForUser,
    setMdbListApiKeyForUser: AccountSettingsService.prototype.setMdbListApiKeyForUser,
    clearMdbListApiKeyForUser: AccountSettingsService.prototype.clearMdbListApiKeyForUser,
  };

  t.after(() => {
    AccountSettingsService.prototype.getMdbListApiKeyMetadataForUser = originals.getMdbListApiKeyMetadataForUser;
    AccountSettingsService.prototype.setMdbListApiKeyForUser = originals.setMdbListApiKeyForUser;
    AccountSettingsService.prototype.clearMdbListApiKeyForUser = originals.clearMdbListApiKeyForUser;
  });

  AccountSettingsService.prototype.getMdbListApiKeyMetadataForUser = async function () {
    return { appUserId: 'user-1', key: 'mdblist.api_key', present: true, fingerprint: 'mdb123abc456' } as never;
  };
  AccountSettingsService.prototype.setMdbListApiKeyForUser = async function () {
    return { appUserId: 'user-1', key: 'mdblist.api_key', present: true, fingerprint: 'new123abc456' } as never;
  };
  AccountSettingsService.prototype.clearMdbListApiKeyForUser = async function () {
    return true;
  };

  const { registerAccountRoutes } = await import('./account.js');
  const app = await buildTestApp((app) => registerAccountRoutes(app, { accountSettingsService: new AccountSettingsService() }));
  t.after(async () => { await app.close(); });

  const auth = { authorization: 'Bearer test' };

  const getResponse = await app.inject({ method: 'GET', url: '/v1/account/secrets/mdblist-api-key', headers: auth });
  assert.equal(getResponse.statusCode, 200);
  const getBody = getResponse.json() as { data: { secret: { key: string; present: boolean; fingerprint: string; value?: string } } };
  assert.equal(getBody.data.secret.key, 'mdblist.api_key');
  assert.equal(getBody.data.secret.present, true);
  assert.equal(getBody.data.secret.fingerprint, 'mdb123abc456');
  assert.equal(getBody.data.secret.value, undefined);

  const putResponse = await app.inject({
    method: 'PUT',
    url: '/v1/account/secrets/mdblist-api-key',
    headers: auth,
    payload: { value: 'new-mdb-key' },
  });
  assert.equal(putResponse.statusCode, 200);
  const putBody = putResponse.json() as { data: { secret: { key: string; present: boolean; fingerprint: string; value?: string } } };
  assert.equal(putBody.data.secret.key, 'mdblist.api_key');
  assert.equal(putBody.data.secret.present, true);
  assert.equal(putBody.data.secret.fingerprint, 'new123abc456');
  assert.equal(putBody.data.secret.value, undefined);

  const deleteResponse = await app.inject({ method: 'DELETE', url: '/v1/account/secrets/mdblist-api-key', headers: auth });
  assert.equal(deleteResponse.statusCode, 200);
  assert.equal(deleteResponse.json().data.deleted, true);
});

test('me route returns account settings envelope', async (t) => {
  const { AccountSettingsService } = await import('../../modules/users/account-settings.service.js');
  const { FeatureEntitlementService } = await import('../../modules/entitlements/feature-entitlement.service.js');
  const { ProfileLocalService } = await import('../../modules/profiles/profile-local.service.js');
  const accountOriginals = {
    getSettings: AccountSettingsService.prototype.getSettings,
    getPricingTierForUser: AccountSettingsService.prototype.getPricingTierForUser,
    getMetadataClientSettingsForUser: FeatureEntitlementService.prototype.getMetadataClientSettingsForUser,
  };
  const profileOriginals = {
    listForAccount: ProfileLocalService.prototype.listForAccount,
  };

  t.after(() => {
    AccountSettingsService.prototype.getSettings = accountOriginals.getSettings;
    AccountSettingsService.prototype.getPricingTierForUser = accountOriginals.getPricingTierForUser;
    FeatureEntitlementService.prototype.getMetadataClientSettingsForUser = accountOriginals.getMetadataClientSettingsForUser;
    ProfileLocalService.prototype.listForAccount = profileOriginals.listForAccount;
  });

  AccountSettingsService.prototype.getSettings = async function () {
    return { metadata: { language: 'en-US' } } as never;
  };
  AccountSettingsService.prototype.getPricingTierForUser = async function () {
    return 'free' as never;
  };
  FeatureEntitlementService.prototype.getMetadataClientSettingsForUser = async function () {
    return { hasMdbListAccess: false };
  };
  ProfileLocalService.prototype.listForAccount = async function () {
    return [{
      id: 'profile-1',
      profileGroupId: 'group-1',
      name: 'Main',
      avatarUrl: null,
      isKids: false,
      sortOrder: 0,
      createdByUserId: 'user-1',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    }] as never;
  };

  const { registerMeRoutes } = await import('./me.js');
  const app = await buildTestApp((app) => registerMeRoutes(app, { profileService: new ProfileLocalService(), accountSettingsService: new AccountSettingsService() }));
  t.after(async () => { await app.close(); });

  const response = await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: 'Bearer test' } });
  assert.equal(response.statusCode, 200);

  const payload = response.json() as { data: { accountSettings: Record<string, any> } };
  assert.equal(payload.data.accountSettings.metadata.language, 'en-US');
  assert.equal(payload.data.accountSettings.metadata.hasMdbListAccess, false);
  assert.equal(payload.data.accountSettings.pricingTier, 'free');
});
