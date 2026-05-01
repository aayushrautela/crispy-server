import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

const { HttpError } = await import('../../lib/errors.js');
const {
  AccountSettingsService,
  normalizeAccountSettingsPatch,
  normalizeProfileSettingsPatch,
} = await import('./account-settings.service.js');

test('getSettings delegates to repository', async () => {
  const settings = { addons: { trakt: true } };
  const service = new AccountSettingsService(
    { getSettingsForUser: async () => settings } as never,
    {} as never,
    async (work) => work({} as never),
  );

  const result = await service.getSettings('user-1');
  assert.deepEqual(result, settings);
});

test('getAiApiKeyForUser returns secret when present', async () => {
  const service = new AccountSettingsService(
    { getSecretForUser: async () => 'ai-key-value' } as never,
    {} as never,
    async (work) => work({} as never),
  );

  const result = await service.getAiApiKeyForUser('user-1');
  assert.equal(result.key, 'ai.api_key');
  assert.equal(result.value, 'ai-key-value');
  assert.equal(result.appUserId, 'user-1');
});

test('getAiApiKeyForUser throws 404 when not found', async () => {
  const service = new AccountSettingsService(
    { getSecretForUser: async () => null } as never,
    {} as never,
    async (work) => work({} as never),
  );

  await assert.rejects(
    () => service.getAiApiKeyForUser('user-1'),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 404);
      return true;
    },
  );
});

test('getMdbListApiKeyForUser returns secret when present', async () => {
  const service = new AccountSettingsService(
    { getSecretForUser: async () => 'mdb-key-value' } as never,
    {} as never,
    async (work) => work({} as never),
  );

  const result = await service.getMdbListApiKeyForUser('user-1');
  assert.equal(result.key, 'mdblist.api_key');
  assert.equal(result.value, 'mdb-key-value');
  assert.equal(result.appUserId, 'user-1');
});

test('getAiProviderIdForUser falls back to default provider', async () => {
  const service = new AccountSettingsService(
    { getSettingsForUser: async () => ({}) } as never,
    {} as never,
    async (work) => work({} as never),
  );

  const result = await service.getAiProviderIdForUser('user-1');
  assert.equal(result, 'openrouter');
});

test('getAiClientSettingsForUser returns provider metadata and selected provider', async () => {
  const service = new AccountSettingsService(
    {
      getSettingsForUser: async () => ({ ai: { providerId: 'openrouter' } }),
      getSecretForUser: async () => 'ai-key-value',
    } as never,
    {} as never,
    async (work) => work({} as never),
  );

  const result = await service.getAiClientSettingsForUser('user-1');
  assert.equal(result.hasAiApiKey, true);
  assert.equal(result.providerId, 'openrouter');
  assert.equal(result.defaultProviderId, 'openrouter');
  assert.equal(result.providers.some((provider) => provider.id === 'openrouter'), true);
});

test('getPricingTierForUser defaults to free', () => {
  const service = new AccountSettingsService(
    {} as never,
    {} as never,
    async (work) => work({} as never),
  );

  assert.equal(service.getPricingTierForUser('user-1'), 'free');
});

test('setAiApiKeyForUser delegates to repository', async () => {
  const service = new AccountSettingsService(
    { setSecretForUser: async () => {} } as never,
    {} as never,
    async (work) => work({} as never),
  );

  const result = await service.setAiApiKeyForUser('user-1', 'new-key');
  assert.equal(result.key, 'ai.api_key');
  assert.equal(result.value, 'new-key');
});

test('clearAiApiKeyForUser returns true when secret existed', async () => {
  const service = new AccountSettingsService(
    { deleteSecretForUser: async () => true } as never,
    {} as never,
    async (work) => work({} as never),
  );

  const result = await service.clearAiApiKeyForUser('user-1');
  assert.equal(result, true);
});

test('setMdbListApiKeyForUser delegates to repository', async () => {
  const service = new AccountSettingsService(
    { setSecretForUser: async () => {} } as never,
    {} as never,
    async (work) => work({} as never),
  );

  const result = await service.setMdbListApiKeyForUser('user-1', 'new-mdb-key');
  assert.equal(result.key, 'mdblist.api_key');
  assert.equal(result.value, 'new-mdb-key');
});

test('clearMdbListApiKeyForUser returns true when secret existed', async () => {
  const service = new AccountSettingsService(
    { deleteSecretForUser: async () => true } as never,
    {} as never,
    async (work) => work({} as never),
  );

  const result = await service.clearMdbListApiKeyForUser('user-1');
  assert.equal(result, true);
});

test('normalizeAccountSettingsPatch keeps editable AI settings and strips derived fields', async () => {
  const result = normalizeAccountSettingsPatch({
    pricingTier: 'pro',
    ai: {
      providerId: 'openrouter',
      hasAiApiKey: true,
      defaultProviderId: 'openai',
      providers: [{ id: 'openai' }],
      endpointUrl: 'https://example.com',
    },
    metadata: {
      hasMdbListAccess: true,
      language: 'en-US',
    },
  });

  assert.deepEqual(result, {
    ai: {
      providerId: 'openrouter',
    },
    metadata: {
      language: 'en-US',
    },
  });
});

test('normalizeAccountSettingsPatch rejects unsupported AI provider ids', async () => {
  assert.throws(
    () => normalizeAccountSettingsPatch({ ai: { providerId: 'bad-provider' } }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 400);
      return true;
    },
  );
});

test('normalizeProfileSettingsPatch rejects account-scoped ai settings', async () => {
  assert.throws(
    () => normalizeProfileSettingsPatch({ ai: { providerId: 'openrouter' } }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 400);
      return true;
    },
  );
});
