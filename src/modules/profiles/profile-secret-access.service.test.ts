import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from '../../lib/errors.js';

function seedTestEnv(): void {
  process.env.NODE_ENV ??= 'test';
  process.env.DATABASE_URL ??= 'postgres://test:test@127.0.0.1:5432/test';
  process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/0';
  process.env.SUPABASE_URL ??= 'https://example.supabase.co';
  process.env.SUPABASE_JWKS_URL ??= 'https://example.supabase.co/auth/v1/.well-known/jwks.json';
  process.env.SUPABASE_JWT_ISSUER ??= 'https://example.supabase.co/auth/v1';
  process.env.SUPABASE_JWT_AUDIENCE ??= 'authenticated';
  process.env.TMDB_API_KEY ??= 'tmdb-test-key';
  process.env.SERVICE_CLIENTS_JSON ??= '[{"serviceId":"test-service","apiKey":"test-key","scopes":["profiles:read"]}]';
}

async function loadService() {
  seedTestEnv();
  return import('./profile-secret-access.service.js');
}

test('getOpenRouterKey returns allowed key', async () => {
  const { ProfileSecretAccessService } = await loadService();
  const service = new ProfileSecretAccessService(
    {
      findById: async (_client: unknown, profileId: string) => ({ id: profileId }),
    } as never,
    {
      getFieldForProfile: async (_client: unknown, profileId: string, fieldKey: string) => {
        assert.equal(profileId, 'profile-1');
        assert.equal(fieldKey, 'ai.openrouter_key');
        return 'openrouter-secret';
      },
    } as never,
    async (work) => work({} as never),
  );

  assert.deepEqual(await service.getOpenRouterKey('profile-1'), {
    profileId: 'profile-1',
    key: 'ai.openrouter_key',
    value: 'openrouter-secret',
  });
});

test('getOpenRouterKey rejects missing profile', async () => {
  const { ProfileSecretAccessService } = await loadService();
  const service = new ProfileSecretAccessService(
    {
      findById: async () => null,
    } as never,
    {} as never,
    async (work) => work({} as never),
  );

  await assert.rejects(() => service.getOpenRouterKey('missing'), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.statusCode, 404);
    assert.equal(error.message, 'Profile not found.');
    return true;
  });
});

test('getOpenRouterKey rejects missing secret', async () => {
  const { ProfileSecretAccessService } = await loadService();
  const service = new ProfileSecretAccessService(
    {
      findById: async (_client: unknown, profileId: string) => ({ id: profileId }),
    } as never,
    {
      getFieldForProfile: async () => null,
    } as never,
    async (work) => work({} as never),
  );

  await assert.rejects(() => service.getOpenRouterKey('profile-1'), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.statusCode, 404);
    assert.equal(error.message, 'Profile secret not found.');
    return true;
  });
});

test('getSecret rejects forbidden field requests', async () => {
  const { ProfileSecretAccessService } = await loadService();
  const service = new ProfileSecretAccessService({} as never, {} as never, async (work) => work({} as never));

  await assert.rejects(() => service.getSecret('profile-1', 'settings_json'), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.statusCode, 403);
    assert.equal(error.message, 'Secret field not allowed.');
    return true;
  });
});
