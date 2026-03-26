import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

async function buildAuthApp() {
  const Fastify = (await import('fastify')).default;
  const { default: errorHandlerPlugin } = await import('./error-handler.js');
  const { default: authPlugin } = await import('./auth.js');

  const app = Fastify();
  await app.register(errorHandlerPlugin);
  await app.register(authPlugin);
  app.get('/user-test', async (request) => {
    await app.requireAuth(request);
    return { auth: request.auth };
  });
  return app;
}

test('auth rejects missing bearer token with 401', async (t) => {
  const app = await buildAuthApp();
  t.after(async () => { await app.close(); });

  const response = await app.inject({ method: 'GET', url: '/user-test' });
  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { code: 'missing_bearer_token', message: 'Missing bearer token.' });
});

test('auth rejects invalid bearer token with 401', async (t) => {
  const app = await buildAuthApp();
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'GET',
    url: '/user-test',
    headers: { authorization: 'Bearer not-a-real-token' },
  });

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { code: 'invalid_bearer_token', message: 'Invalid bearer token.' });
});

test('auth rejects malformed authorization header', async (t) => {
  const app = await buildAuthApp();
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'GET',
    url: '/user-test',
    headers: { authorization: 'Basic abc123' },
  });

  assert.equal(response.statusCode, 401);
});
