import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from '../../lib/errors.js';

function seedTestEnv(): void {
  process.env.NODE_ENV ??= 'test';
  process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/crispy_test';
  process.env.REDIS_URL ||= 'redis://127.0.0.1:6379';
  process.env.AUTH_JWKS_URL ||= 'https://example.supabase.co/auth/v1/.well-known/jwks.json';
  process.env.AUTH_JWT_ISSUER ||= 'https://example.supabase.co/auth/v1';
  process.env.AUTH_JWT_AUDIENCE ||= 'authenticated';
  process.env.TMDB_API_KEY ||= 'tmdb-key';
  process.env.SERVICE_CLIENTS_JSON ||= '[{"serviceId":"test-service","apiKey":"test-key","scopes":["profiles:read"]}]';
}

test('patchSettings rejects account-scoped keys in profile settings payloads', async () => {
  seedTestEnv();
  const { normalizeSettingsPatch } = await import('./account-settings.service.js');

  assert.throws(
    () => normalizeSettingsPatch({ addons: { trakt: true } }),
    /account-scoped/,
  );
  assert.throws(
    () => normalizeSettingsPatch({ 'ai.openrouter_key': 'secret' }),
    /account-scoped/,
  );
});

test('getSecretForAccountProfile resolves account secret through account-owned profile', async () => {
  seedTestEnv();
  const { AccountSettingsService } = await import('./account-settings.service.js');
  const service = new AccountSettingsService(
    {
      getSecretForUser: async (_client: unknown, userId: string, fieldKey: string) => {
        assert.equal(userId, 'user-1');
        assert.equal(fieldKey, 'ai.openrouter_key');
        return 'openrouter-secret';
      },
    } as never,
    {
      findByIdForOwnerUser: async (_client: unknown, profileId: string, accountId: string) => {
        assert.equal(profileId, 'profile-1');
        assert.equal(accountId, 'user-1');
        return { id: profileId };
      },
    } as never,
    async (work) => work({} as never),
  );

  const result = await service.getSecretForAccountProfile('user-1', 'profile-1', 'ai.openrouter_key');
  assert.deepEqual(result, {
    appUserId: 'user-1',
    key: 'ai.openrouter_key',
    value: 'openrouter-secret',
  });
});

test('getSecretForAccountProfile rejects missing account secret', async () => {
  seedTestEnv();
  const { AccountSettingsService } = await import('./account-settings.service.js');
  const service = new AccountSettingsService(
    {
      getSecretForUser: async () => null,
    } as never,
    {
      findByIdForOwnerUser: async () => ({ id: 'profile-1' }),
    } as never,
    async (work) => work({} as never),
  );

  await assert.rejects(() => service.getSecretForAccountProfile('user-1', 'profile-1', 'ai.openrouter_key'), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.statusCode, 404);
    assert.equal(error.message, 'Account secret not found.');
    return true;
  });
});
