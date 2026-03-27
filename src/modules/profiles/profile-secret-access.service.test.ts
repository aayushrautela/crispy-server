import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

const { HttpError } = await import('../../lib/errors.js');
const { ProfileSecretAccessService } = await import('./profile-secret-access.service.js');

test('getAiApiKeyForAccountProfile returns secret when profile exists', async () => {
  const service = new ProfileSecretAccessService(
    {
      getSecretForAccountProfile: async () => ({ appUserId: 'user-1', key: 'ai.api_key', value: 'ai-key' }),
      getAiProviderIdForUser: async () => 'openrouter',
    } as never,
  );

  const result = await service.getAiApiKeyForAccountProfile('user-1', 'profile-1');
  assert.equal(result.key, 'ai.api_key');
  assert.equal(result.value, 'ai-key');
  assert.equal(result.providerId, 'openrouter');
});

test('getSecretForAccountProfile rejects unknown fields', async () => {
  const service = new ProfileSecretAccessService(
    {} as never,
  );

  await assert.rejects(
    () => service.getSecretForAccountProfile('user-1', 'profile-1', 'invalid.field'),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 403);
      return true;
    },
  );
});

test('getSecretForAccountProfile throws 404 when profile not found', async () => {
  const service = new ProfileSecretAccessService(
    {
      getSecretForAccountProfile: async () => {
        throw new HttpError(404, 'Profile not found for account.');
      },
      getAiProviderIdForUser: async () => 'openai',
    } as never,
  );

  await assert.rejects(
    () => service.getSecretForAccountProfile('user-1', 'missing', 'ai.api_key'),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 404);
      return true;
    },
  );
});
