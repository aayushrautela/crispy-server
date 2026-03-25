import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from '../../lib/errors.js';

function seedTestEnv(): void {
  process.env.NODE_ENV ??= 'test';
  process.env.DATABASE_URL ??= 'postgres://test:test@127.0.0.1:5432/test';
  process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/0';
  process.env.AUTH_JWKS_URL ??= 'https://example.supabase.co/auth/v1/.well-known/jwks.json';
  process.env.AUTH_JWT_ISSUER ??= 'https://example.supabase.co/auth/v1';
  process.env.AUTH_JWT_AUDIENCE ??= 'authenticated';
  process.env.TMDB_API_KEY ??= 'tmdb-test-key';
  process.env.SERVICE_CLIENTS_JSON ??= '[{"serviceId":"test-service","apiKey":"test-key","scopes":["profiles:read"]}]';
}

async function loadService() {
  seedTestEnv();
  return import('./profile-secret-access.service.js');
}

test('getOpenRouterKeyForAccountProfile returns allowed key', async () => {
  const { ProfileSecretAccessService } = await loadService();
  const service = new ProfileSecretAccessService(
    {
      getSecretForAccountProfile: async (accountId: string, profileId: string, fieldKey: string) => {
        assert.equal(accountId, 'account-1');
        assert.equal(profileId, 'profile-1');
        assert.equal(fieldKey, 'ai.openrouter_key');
        return { appUserId: 'user-1', key: 'ai.openrouter_key', value: 'openrouter-secret' };
      },
    } as never,
    {
      findByIdForOwnerUser: async (_client: unknown, profileId: string, accountId: string) => {
        assert.equal(profileId, 'profile-1');
        assert.equal(accountId, 'account-1');
        return { id: profileId };
      },
    } as never,
    async (work) => work({} as never),
  );

  assert.deepEqual(await service.getOpenRouterKeyForAccountProfile('account-1', 'profile-1'), {
    appUserId: 'user-1',
    key: 'ai.openrouter_key',
    value: 'openrouter-secret',
  });
});

test('getOpenRouterKeyForAccountProfile rejects missing profile', async () => {
  const { ProfileSecretAccessService } = await loadService();
  const service = new ProfileSecretAccessService(
    {} as never,
    {
      findByIdForOwnerUser: async () => null,
    } as never,
    async (work) => work({} as never),
  );

  await assert.rejects(() => service.getOpenRouterKeyForAccountProfile('account-1', 'missing'), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.statusCode, 404);
    assert.equal(error.message, 'Profile not found for account.');
    return true;
  });
});

test('getOpenRouterKeyForAccountProfile rejects missing secret', async () => {
  const { ProfileSecretAccessService } = await loadService();
  const service = new ProfileSecretAccessService(
    {
      getSecretForAccountProfile: async () => {
        throw new HttpError(404, 'Account secret not found.');
      },
    } as never,
    {
      findByIdForOwnerUser: async () => ({ id: 'profile-1' }),
    } as never,
    async (work) => work({} as never),
  );

  await assert.rejects(() => service.getOpenRouterKeyForAccountProfile('account-1', 'profile-1'), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.statusCode, 404);
    assert.equal(error.message, 'Account secret not found.');
    return true;
  });
});

test('getSecretForAccountProfile rejects forbidden field requests', async () => {
  const { ProfileSecretAccessService } = await loadService();
  const service = new ProfileSecretAccessService({} as never, {} as never, async (work) => work({} as never));

  await assert.rejects(() => service.getSecretForAccountProfile('account-1', 'profile-1', 'settings_json'), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.statusCode, 403);
    assert.equal(error.message, 'Secret field not allowed.');
    return true;
  });
});
