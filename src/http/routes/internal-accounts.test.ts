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

  const app = Fastify();
  await app.register(errorHandlerPlugin);
  await app.register(serviceAuthPlugin);
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
