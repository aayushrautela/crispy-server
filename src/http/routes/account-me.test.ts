import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from '../../lib/errors.js';
import { buildTestApp, seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

test('account settings route returns AI client configuration envelope', async (t) => {
  const { AccountSettingsService } = await import('../../modules/users/account-settings.service.js');
  const { FeatureEntitlementService } = await import('../../modules/entitlements/feature-entitlement.service.js');
  const originals = {
    getSettings: AccountSettingsService.prototype.getSettings,
    getAiClientSettingsForUser: AccountSettingsService.prototype.getAiClientSettingsForUser,
    getMetadataClientSettingsForUser: FeatureEntitlementService.prototype.getMetadataClientSettingsForUser,
  };

  t.after(() => {
    Object.assign(AccountSettingsService.prototype, originals);
  });

  AccountSettingsService.prototype.getSettings = async function () {
    return { ai: { providerId: 'openrouter' }, metadata: { language: 'en-US' } } as never;
  };
  AccountSettingsService.prototype.getAiClientSettingsForUser = async function () {
    return {
      providerId: 'openrouter',
      hasAiApiKey: true,
      defaultProviderId: 'openai',
      providers: [{ id: 'openai', label: 'OpenAI', endpointUrl: 'https://api.openai.com/v1/chat/completions' }],
    } as never;
  };
  FeatureEntitlementService.prototype.getMetadataClientSettingsForUser = async function () {
    return { hasMdbListAccess: true };
  };

  const { registerAccountRoutes } = await import('./account.js');
  const app = await buildTestApp(registerAccountRoutes);
  t.after(async () => { await app.close(); });

  const response = await app.inject({ method: 'GET', url: '/v1/account/settings', headers: { authorization: 'Bearer test' } });
  assert.equal(response.statusCode, 200);

  const payload = response.json() as { settings: Record<string, any> };
  assert.equal(payload.settings.ai.providerId, 'openrouter');
  assert.equal(payload.settings.ai.hasAiApiKey, true);
  assert.equal(payload.settings.ai.defaultProviderId, 'openai');
  assert.equal(Array.isArray(payload.settings.ai.providers), true);
  assert.equal(payload.settings.metadata.hasMdbListAccess, true);
  assert.equal(payload.settings.pricingTier, 'free');
});

test('account settings patch route returns merged AI client configuration envelope', async (t) => {
  const { AccountSettingsService } = await import('../../modules/users/account-settings.service.js');
  const { FeatureEntitlementService } = await import('../../modules/entitlements/feature-entitlement.service.js');
  const originals = {
    patchSettings: AccountSettingsService.prototype.patchSettings,
    getAiClientSettingsForUser: AccountSettingsService.prototype.getAiClientSettingsForUser,
    getMetadataClientSettingsForUser: FeatureEntitlementService.prototype.getMetadataClientSettingsForUser,
  };

  t.after(() => {
    Object.assign(AccountSettingsService.prototype, originals);
  });

  AccountSettingsService.prototype.patchSettings = async function (_userId, patch) {
    return patch as never;
  };
  AccountSettingsService.prototype.getAiClientSettingsForUser = async function () {
    return {
      providerId: 'openrouter',
      hasAiApiKey: false,
      defaultProviderId: 'openai',
      providers: [{ id: 'openrouter', label: 'OpenRouter', endpointUrl: 'https://openrouter.ai/api/v1/chat/completions' }],
    } as never;
  };
  FeatureEntitlementService.prototype.getMetadataClientSettingsForUser = async function () {
    return { hasMdbListAccess: false };
  };

  const { registerAccountRoutes } = await import('./account.js');
  const app = await buildTestApp(registerAccountRoutes);
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'PATCH',
    url: '/v1/account/settings',
    headers: { authorization: 'Bearer test' },
    payload: { ai: { providerId: 'openrouter' } },
  });
  assert.equal(response.statusCode, 200);

  const payload = response.json() as { settings: Record<string, any> };
  assert.equal(payload.settings.ai.providerId, 'openrouter');
  assert.equal(payload.settings.ai.hasAiApiKey, false);
  assert.equal(payload.settings.metadata.hasMdbListAccess, false);
  assert.equal(payload.settings.pricingTier, 'free');
});

test('account settings patch route returns API error contract for unsupported AI provider', async (t) => {
  const { AccountSettingsService } = await import('../../modules/users/account-settings.service.js');
  const originals = {
    patchSettings: AccountSettingsService.prototype.patchSettings,
  };

  t.after(() => {
    Object.assign(AccountSettingsService.prototype, originals);
  });

  AccountSettingsService.prototype.patchSettings = async function () {
    throw new HttpError(400, 'AI provider is not supported.');
  };

  const { registerAccountRoutes } = await import('./account.js');
  const app = await buildTestApp(registerAccountRoutes);
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'PATCH',
    url: '/v1/account/settings',
    headers: { authorization: 'Bearer test' },
    payload: { ai: { providerId: 'bad-provider' } },
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json(), {
    code: 'ai_provider_is_not_supported',
    message: 'AI provider is not supported.',
  });
});

test('account MDBList secret routes delegate to account settings service', async (t) => {
  const { AccountSettingsService } = await import('../../modules/users/account-settings.service.js');
  const originals = {
    getMdbListApiKeyForUser: AccountSettingsService.prototype.getMdbListApiKeyForUser,
    setMdbListApiKeyForUser: AccountSettingsService.prototype.setMdbListApiKeyForUser,
    clearMdbListApiKeyForUser: AccountSettingsService.prototype.clearMdbListApiKeyForUser,
  };

  t.after(() => {
    Object.assign(AccountSettingsService.prototype, originals);
  });

  AccountSettingsService.prototype.getMdbListApiKeyForUser = async function () {
    return { appUserId: 'user-1', key: 'mdblist.api_key', value: 'mdb-user-key' } as never;
  };
  AccountSettingsService.prototype.setMdbListApiKeyForUser = async function (_userId, value) {
    return { appUserId: 'user-1', key: 'mdblist.api_key', value } as never;
  };
  AccountSettingsService.prototype.clearMdbListApiKeyForUser = async function () {
    return true;
  };

  const { registerAccountRoutes } = await import('./account.js');
  const app = await buildTestApp(registerAccountRoutes);
  t.after(async () => { await app.close(); });

  const auth = { authorization: 'Bearer test' };

  const getResponse = await app.inject({ method: 'GET', url: '/v1/account/secrets/mdblist-api-key', headers: auth });
  assert.equal(getResponse.statusCode, 200);
  assert.deepEqual(getResponse.json(), {
    secret: { appUserId: 'user-1', key: 'mdblist.api_key', value: 'mdb-user-key' },
  });

  const putResponse = await app.inject({
    method: 'PUT',
    url: '/v1/account/secrets/mdblist-api-key',
    headers: auth,
    payload: { value: 'new-mdb-key' },
  });
  assert.equal(putResponse.statusCode, 200);
  assert.deepEqual(putResponse.json(), {
    secret: { appUserId: 'user-1', key: 'mdblist.api_key', value: 'new-mdb-key' },
  });

  const deleteResponse = await app.inject({ method: 'DELETE', url: '/v1/account/secrets/mdblist-api-key', headers: auth });
  assert.equal(deleteResponse.statusCode, 200);
  assert.deepEqual(deleteResponse.json(), { deleted: true });
});

test('me route returns AI client configuration in account settings', async (t) => {
  const { AccountSettingsService } = await import('../../modules/users/account-settings.service.js');
  const { FeatureEntitlementService } = await import('../../modules/entitlements/feature-entitlement.service.js');
  const { ProfileService } = await import('../../modules/profiles/profile.service.js');
  const accountOriginals = {
    getSettings: AccountSettingsService.prototype.getSettings,
    getAiClientSettingsForUser: AccountSettingsService.prototype.getAiClientSettingsForUser,
    getMetadataClientSettingsForUser: FeatureEntitlementService.prototype.getMetadataClientSettingsForUser,
  };
  const profileOriginals = {
    listForAccount: ProfileService.prototype.listForAccount,
  };

  t.after(() => {
    Object.assign(AccountSettingsService.prototype, accountOriginals);
    Object.assign(ProfileService.prototype, profileOriginals);
  });

  AccountSettingsService.prototype.getSettings = async function () {
    return { ai: { providerId: 'openrouter' } } as never;
  };
  AccountSettingsService.prototype.getAiClientSettingsForUser = async function () {
    return {
      providerId: 'openrouter',
      hasAiApiKey: true,
      defaultProviderId: 'openai',
      providers: [{ id: 'openrouter', label: 'OpenRouter', endpointUrl: 'https://openrouter.ai/api/v1/chat/completions' }],
    } as never;
  };
  FeatureEntitlementService.prototype.getMetadataClientSettingsForUser = async function () {
    return { hasMdbListAccess: false };
  };
  ProfileService.prototype.listForAccount = async function () {
    return [{
      id: 'profile-1',
      profileGroupId: 'group-1',
      name: 'Main',
      avatarKey: null,
      isKids: false,
      sortOrder: 0,
      createdByUserId: 'user-1',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    }] as never;
  };

  const { registerMeRoutes } = await import('./me.js');
  const app = await buildTestApp(registerMeRoutes);
  t.after(async () => { await app.close(); });

  const response = await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: 'Bearer test' } });
  assert.equal(response.statusCode, 200);

  const payload = response.json() as { accountSettings: Record<string, any> };
  assert.equal(payload.accountSettings.ai.providerId, 'openrouter');
  assert.equal(payload.accountSettings.ai.hasAiApiKey, true);
  assert.equal(payload.accountSettings.metadata.hasMdbListAccess, false);
  assert.equal(payload.accountSettings.pricingTier, 'free');
});
