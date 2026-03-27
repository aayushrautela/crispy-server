import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp, seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

test('account settings route returns AI client configuration envelope', async (t) => {
  const { AccountSettingsService } = await import('../../modules/users/account-settings.service.js');
  const originals = {
    getSettings: AccountSettingsService.prototype.getSettings,
    getAiClientSettingsForUser: AccountSettingsService.prototype.getAiClientSettingsForUser,
    getOmdbApiKeyForUser: AccountSettingsService.prototype.getOmdbApiKeyForUser,
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
  AccountSettingsService.prototype.getOmdbApiKeyForUser = async function () {
    return { appUserId: 'user-1', key: 'metadata.omdb_api_key', value: 'omdb-secret' } as never;
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
  assert.equal(payload.settings.metadata.hasOmdbApiKey, true);
});

test('account settings patch route returns merged AI client configuration envelope', async (t) => {
  const { AccountSettingsService } = await import('../../modules/users/account-settings.service.js');
  const originals = {
    patchSettings: AccountSettingsService.prototype.patchSettings,
    getAiClientSettingsForUser: AccountSettingsService.prototype.getAiClientSettingsForUser,
    getOmdbApiKeyForUser: AccountSettingsService.prototype.getOmdbApiKeyForUser,
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
  AccountSettingsService.prototype.getOmdbApiKeyForUser = async function () {
    throw new Error('missing');
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
  assert.equal(payload.settings.metadata.hasOmdbApiKey, false);
});

test('me route returns AI client configuration in account settings', async (t) => {
  const { AccountSettingsService } = await import('../../modules/users/account-settings.service.js');
  const { ProfileService } = await import('../../modules/profiles/profile.service.js');
  const accountOriginals = {
    getSettings: AccountSettingsService.prototype.getSettings,
    getAiClientSettingsForUser: AccountSettingsService.prototype.getAiClientSettingsForUser,
    getOmdbApiKeyForUser: AccountSettingsService.prototype.getOmdbApiKeyForUser,
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
  AccountSettingsService.prototype.getOmdbApiKeyForUser = async function () {
    throw new Error('missing');
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
  assert.equal(payload.accountSettings.metadata.hasOmdbApiKey, false);
});
