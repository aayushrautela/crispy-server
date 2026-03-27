import test from 'node:test';
import assert from 'node:assert/strict';
import { setTestEnv } from '../../test-helpers.js';

setTestEnv({
  SERVICE_CLIENTS_JSON: JSON.stringify([{
    serviceId: 'test-service',
    apiKey: 'test-key',
    scopes: ['profiles:read', 'watch:read', 'taste-profile:read', 'taste-profile:write', 'recommendations:read', 'recommendations:write', 'profile-secrets:read', 'provider-connections:read', 'provider-tokens:read', 'provider-tokens:refresh', 'admin:diagnostics:read'],
    status: 'active',
  }]),
});

async function buildInternalApp() {
  const Fastify = (await import('fastify')).default;
  const { default: errorHandlerPlugin } = await import('../plugins/error-handler.js');
  const { default: serviceAuthPlugin } = await import('../plugins/service-auth.js');
  const { registerInternalAccountRoutes } = await import('./internal-accounts.js');
  const { HttpError } = await import('../../lib/errors.js');

  const app = Fastify();
  await app.register(errorHandlerPlugin);
  await app.register(serviceAuthPlugin);
  app.decorate('requireScopes', (request, scopes) => {
    const granted = new Set(request.auth?.scopes ?? []);
    for (const scope of scopes) {
      if (!granted.has(scope)) {
        throw new HttpError(403, `Missing required scope: ${scope}`);
      }
    }
  });
  await registerInternalAccountRoutes(app);
  return app;
}

test('internal accounts route requires service auth', async (t) => {
  const app = await buildInternalApp();
  t.after(async () => { await app.close(); });

  const response = await app.inject({ method: 'GET', url: '/internal/v1/accounts/by-email/test@example.com' });
  assert.equal(response.statusCode, 401);
});

test('internal accounts route rejects invalid service credentials', async (t) => {
  const app = await buildInternalApp();
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'GET',
    url: '/internal/v1/accounts/by-email/test@example.com',
    headers: { 'x-service-id': 'test-service', 'x-api-key': 'wrong-key' },
  });

  assert.equal(response.statusCode, 401);
});

test('internal accounts route accepts valid service auth structure', async (t) => {
  const app = await buildInternalApp();
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'GET',
    url: '/internal/v1/accounts/by-email/test@example.com',
    headers: { 'x-service-id': 'test-service', 'x-api-key': 'test-key' },
  });

  assert.ok([200, 404, 500].includes(response.statusCode));
});

test('internal AI secret route returns provider-aware secret contract', async (t) => {
  const { ProfileSecretAccessService } = await import('../../modules/profiles/profile-secret-access.service.js');
  const original = ProfileSecretAccessService.prototype.getAiApiKeyForAccountProfile;

  ProfileSecretAccessService.prototype.getAiApiKeyForAccountProfile = async function () {
    return {
      appUserId: 'account-1',
      key: 'ai.api_key',
      value: 'secret-value',
      providerId: 'openrouter',
    } as never;
  };

  t.after(() => {
    ProfileSecretAccessService.prototype.getAiApiKeyForAccountProfile = original;
  });

  const app = await buildInternalApp();
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'GET',
    url: '/internal/v1/accounts/account-1/profiles/profile-1/secrets/ai-api-key',
    headers: { 'x-service-id': 'test-service', 'x-api-key': 'test-key' },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    secret: {
      appUserId: 'account-1',
      key: 'ai.api_key',
      value: 'secret-value',
      providerId: 'openrouter',
    },
  });
});
