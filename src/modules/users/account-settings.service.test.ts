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

test('getSecretForProfile resolves account secret through profile owner', async () => {
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
      findById: async (_client: unknown, profileId: string) => ({ id: profileId }),
      findOwnerUserIdById: async (_client: unknown, profileId: string) => {
        assert.equal(profileId, 'profile-1');
        return 'user-1';
      },
    } as never,
    async (work) => work({} as never),
  );

  const result = await service.getOpenRouterKeyForProfile('profile-1');
  assert.deepEqual(result, {
    appUserId: 'user-1',
    key: 'ai.openrouter_key',
    value: 'openrouter-secret',
  });
});

test('getSecretForProfile rejects missing account secret', async () => {
  seedTestEnv();
  const { AccountSettingsService } = await import('./account-settings.service.js');
  const service = new AccountSettingsService(
    {
      getSecretForUser: async () => null,
    } as never,
    {
      findById: async () => ({ id: 'profile-1' }),
      findOwnerUserIdById: async () => 'user-1',
    } as never,
    async (work) => work({} as never),
  );

  await assert.rejects(() => service.getOpenRouterKeyForProfile('profile-1'), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.statusCode, 404);
    assert.equal(error.message, 'Account secret not found.');
    return true;
  });
});
