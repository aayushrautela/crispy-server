import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

const { HttpError } = await import('../../lib/errors.js');
const { AccountSettingsService } = await import('./account-settings.service.js');

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
    { clearSecretForUser: async () => true } as never,
    {} as never,
    async (work) => work({} as never),
  );

  const result = await service.clearAiApiKeyForUser('user-1');
  assert.equal(result, true);
});

test('listOmdbApiKeysForLookup separates own and pooled keys', async () => {
  const service = new AccountSettingsService(
    {
      listSecretsForField: async () => [
        { appUserId: 'user-1', value: 'own-key' },
        { appUserId: 'user-2', value: 'pooled-key-1' },
        { appUserId: 'user-1', value: 'own-key' },
      ],
    } as never,
    {} as never,
    async (work) => work({} as never),
  );

  const result = await service.listOmdbApiKeysForLookup('user-1');
  assert.deepEqual(result.ownKeys, ['own-key']);
  assert.deepEqual(result.pooledKeys, ['pooled-key-1']);
});
