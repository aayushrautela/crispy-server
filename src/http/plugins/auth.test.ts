import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';

function configureTestEnv(): void {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgres://test:test@127.0.0.1:5432/test';
  process.env.REDIS_URL = 'redis://127.0.0.1:6379/0';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.AUTH_JWT_AUDIENCE = 'authenticated';
  process.env.TMDB_API_KEY = 'tmdb-test-key';
  process.env.SERVICE_CLIENTS_JSON = '[]';
}

async function buildAuthApp() {
  configureTestEnv();
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

test('auth rejects invalid bearer token with 401', async (t) => {
  const app = await buildAuthApp();
  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: 'GET',
    url: '/user-test',
    headers: {
      authorization: 'Bearer not-a-real-token',
    },
  });

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { error: 'Invalid bearer token.' });
});
