import test from 'node:test';
import assert from 'node:assert/strict';
import { setTestEnv } from '../../test-helpers.js';

const SERVICE_CLIENTS = JSON.stringify([
  { serviceId: 'svc', apiKey: 'secret', scopes: ['profiles:read'], status: 'active' },
  { serviceId: 'svc-disabled', apiKey: 'disabled-secret', scopes: ['profiles:read'], status: 'disabled' },
  { serviceId: 'crispy-recommendation-engine', apiKey: 'engine-secret', scopes: ['profiles:read', 'recommendation-work:claim'], status: 'active' },
]);

setTestEnv({ SERVICE_CLIENTS_JSON: SERVICE_CLIENTS });

async function buildServiceAuthApp() {
  const Fastify = (await import('fastify')).default;
  const { default: errorHandlerPlugin } = await import('./error-handler.js');
  const { default: serviceAuthPlugin } = await import('./service-auth.js');

  const app = Fastify();
  await app.register(errorHandlerPlugin);
  await app.register(serviceAuthPlugin);
  app.get('/internal-test', async (request) => {
    await app.requireServiceAuth(request);
    return { auth: request.auth };
  });
  return app;
}

test('service auth rejects missing x-service-id header', async (t) => {
  const app = await buildServiceAuthApp();
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'GET',
    url: '/internal-test',
    headers: { 'x-api-key': 'secret' },
  });

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { error: 'Missing service id.' });
});

test('service auth rejects missing x-api-key header', async (t) => {
  const app = await buildServiceAuthApp();
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'GET',
    url: '/internal-test',
    headers: { 'x-service-id': 'svc' },
  });

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { error: 'Missing API key.' });
});

test('service auth rejects invalid credentials', async (t) => {
  const app = await buildServiceAuthApp();
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'GET',
    url: '/internal-test',
    headers: { 'x-service-id': 'svc', 'x-api-key': 'wrong' },
  });

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { error: 'Invalid service credentials.' });
});

test('service auth rejects disabled clients', async (t) => {
  const app = await buildServiceAuthApp();
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'GET',
    url: '/internal-test',
    headers: { 'x-service-id': 'svc-disabled', 'x-api-key': 'disabled-secret' },
  });

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { error: 'Invalid service credentials.' });
});

test('service auth authenticates valid active clients', async (t) => {
  const app = await buildServiceAuthApp();
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'GET',
    url: '/internal-test',
    headers: { 'x-service-id': 'crispy-recommendation-engine', 'x-api-key': 'engine-secret' },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    auth: {
      type: 'service',
      appUserId: null,
      serviceId: 'crispy-recommendation-engine',
      scopes: ['profiles:read', 'recommendation-work:claim'],
      authSubject: null,
      email: null,
      tokenId: null,
      consumerId: null,
    },
  });
});
