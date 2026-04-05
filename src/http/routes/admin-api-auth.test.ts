import test from 'node:test';
import assert from 'node:assert/strict';
import { setTestEnv } from '../../test-helpers.js';

setTestEnv({
  ADMIN_UI_USER: 'admin-user',
  ADMIN_UI_PASSWORD: 'admin-pass',
  ADMIN_UI_SESSION_SECRET: 'admin-session-secret-for-tests',
  SERVICE_CLIENTS_JSON: '[]',
});

test('admin api requires an authenticated admin session', async (t) => {
  const Fastify = (await import('fastify')).default;
  const { default: errorHandlerPlugin } = await import('../plugins/error-handler.js');
  const { default: adminUiAuthPlugin } = await import('../plugins/admin-ui-auth.js');
  const { registerAdminUiRoutes } = await import('./admin-ui.js');
  const { registerAdminApiRoutes } = await import('./admin-api.js');

  const app = Fastify();
  await app.register(errorHandlerPlugin);
  await app.register(adminUiAuthPlugin);
  await registerAdminUiRoutes(app);
  await registerAdminApiRoutes(app);

  t.after(async () => { await app.close(); });

  const response = await app.inject({ method: 'GET', url: '/admin/api/worker/control-status' });

  assert.equal(response.statusCode, 401);
});

test('admin api rejects state-changing requests without the admin csrf header', async (t) => {
  const Fastify = (await import('fastify')).default;
  const { default: errorHandlerPlugin } = await import('../plugins/error-handler.js');
  const { default: adminUiAuthPlugin } = await import('../plugins/admin-ui-auth.js');
  const { registerAdminUiRoutes } = await import('./admin-ui.js');
  const { registerAdminApiRoutes } = await import('./admin-api.js');

  const app = Fastify();
  await app.register(errorHandlerPlugin);
  await app.register(adminUiAuthPlugin);
  await registerAdminUiRoutes(app);
  await registerAdminApiRoutes(app);

  t.after(async () => { await app.close(); });

  const loginPage = await app.inject({ method: 'GET', url: '/admin/login' });
  const formToken = readHiddenInput(loginPage.body, 'formToken');
  const loginResponse = await app.inject({
    method: 'POST',
    url: '/admin/login',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      host: 'localhost',
      origin: 'http://localhost',
    },
    payload: new URLSearchParams({
      formToken,
      username: 'admin-user',
      password: 'admin-pass',
    }).toString(),
  });
  const sessionCookie = readCookieHeader(loginResponse.headers['set-cookie']);

  const response = await app.inject({
    method: 'POST',
    url: '/admin/api/accounts/test-account/profiles/test-profile/imports/start',
    headers: {
      cookie: sessionCookie,
      'content-type': 'application/json',
      host: 'localhost',
      origin: 'http://localhost',
    },
    payload: JSON.stringify({ provider: 'trakt' }),
  });

  assert.equal(response.statusCode, 403);
  assert.match(response.body, /Invalid admin CSRF token/);
});

function readCookieHeader(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }
  return value ?? '';
}

function readHiddenInput(html: string, name: string): string {
  const pattern = new RegExp(`<input[^>]+name="${name}"[^>]+value="([^"]+)"`, 'i');
  const match = html.match(pattern);
  assert.ok(match, `expected hidden input ${name}`);
  return match[1] ?? '';
}
