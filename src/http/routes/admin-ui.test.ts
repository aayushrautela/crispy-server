import test from 'node:test';
import assert from 'node:assert/strict';
import { setTestEnv } from '../../test-helpers.js';

setTestEnv({
  ADMIN_UI_USER: 'admin-user',
  ADMIN_UI_PASSWORD: 'admin-pass',
  ADMIN_UI_SESSION_SECRET: 'admin-session-secret-for-tests',
  SERVICE_CLIENTS_JSON: '[]',
});

test('admin ui renders login page and redirects unauthenticated admin requests', async (t) => {
  const Fastify = (await import('fastify')).default;
  const { default: errorHandlerPlugin } = await import('../plugins/error-handler.js');
  const { default: adminUiAuthPlugin } = await import('../plugins/admin-ui-auth.js');
  const { registerAdminUiRoutes } = await import('./admin-ui.js');

  const app = Fastify();
  await app.register(errorHandlerPlugin);
  await app.register(adminUiAuthPlugin);
  await registerAdminUiRoutes(app);

  t.after(async () => { await app.close(); });

  const login = await app.inject({ method: 'GET', url: '/admin/login' });
  assert.equal(login.statusCode, 200);
  assert.match(String(login.headers['content-type']), /text\/html/);
  assert.match(login.body, /Admin login/);

  const unauthorized = await app.inject({ method: 'GET', url: '/admin' });
  assert.equal(unauthorized.statusCode, 303);
  assert.equal(unauthorized.headers.location, '/admin/login');
});

test('admin ui signs in, serves the dashboard, and logs out safely', async (t) => {
  const Fastify = (await import('fastify')).default;
  const { default: errorHandlerPlugin } = await import('../plugins/error-handler.js');
  const { default: adminUiAuthPlugin } = await import('../plugins/admin-ui-auth.js');
  const { registerAdminUiRoutes } = await import('./admin-ui.js');

  const app = Fastify();
  await app.register(errorHandlerPlugin);
  await app.register(adminUiAuthPlugin);
  await registerAdminUiRoutes(app);

  t.after(async () => { await app.close(); });

  const loginPage = await app.inject({ method: 'GET', url: '/admin/login' });
  const loginFormToken = readHiddenInput(loginPage.body, 'formToken');

  const loginResponse = await app.inject({
    method: 'POST',
    url: '/admin/login',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      host: 'localhost',
      origin: 'http://localhost',
    },
    payload: new URLSearchParams({
      formToken: loginFormToken,
      username: 'admin-user',
      password: 'admin-pass',
    }).toString(),
  });

  assert.equal(loginResponse.statusCode, 303);
  assert.equal(loginResponse.headers.location, '/admin');

  const sessionCookie = readCookieHeader(loginResponse.headers['set-cookie']);
  assert.match(sessionCookie, /crispy_admin_session=/);

  const authorized = await app.inject({
    method: 'GET',
    url: '/admin',
    headers: { cookie: sessionCookie },
  });

  assert.equal(authorized.statusCode, 200);
  assert.match(String(authorized.headers['content-type']), /text\/html/);
  assert.match(authorized.body, /Crispy Control Plane/);
  assert.match(authorized.body, /Reset recommendation tracking jobs/);

  const logoutToken = readHiddenInput(authorized.body, 'csrfToken');
  const logoutResponse = await app.inject({
    method: 'POST',
    url: '/admin/logout',
    headers: {
      cookie: sessionCookie,
      'content-type': 'application/x-www-form-urlencoded',
      host: 'localhost',
      origin: 'http://localhost',
    },
    payload: new URLSearchParams({ csrfToken: logoutToken }).toString(),
  });

  assert.equal(logoutResponse.statusCode, 303);
  assert.equal(logoutResponse.headers.location, '/admin/login');
  assert.match(readCookieHeader(logoutResponse.headers['set-cookie']), /Max-Age=0/);
});

test('admin ui embeds provider token refresh actions in the dashboard client', async (t) => {
  const Fastify = (await import('fastify')).default;
  const { default: errorHandlerPlugin } = await import('../plugins/error-handler.js');
  const { default: adminUiAuthPlugin } = await import('../plugins/admin-ui-auth.js');
  const { registerAdminUiRoutes } = await import('./admin-ui.js');

  const app = Fastify();
  await app.register(errorHandlerPlugin);
  await app.register(adminUiAuthPlugin);
  await registerAdminUiRoutes(app);

  t.after(async () => { await app.close(); });

  const loginPage = await app.inject({ method: 'GET', url: '/admin/login' });
  const loginFormToken = readHiddenInput(loginPage.body, 'formToken');
  const loginResponse = await app.inject({
    method: 'POST',
    url: '/admin/login',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      host: 'localhost',
      origin: 'http://localhost',
    },
    payload: new URLSearchParams({
      formToken: loginFormToken,
      username: 'admin-user',
      password: 'admin-pass',
    }).toString(),
  });

  const sessionCookie = readCookieHeader(loginResponse.headers['set-cookie']);
  const authorized = await app.inject({
    method: 'GET',
    url: '/admin',
    headers: { cookie: sessionCookie },
  });

  assert.equal(authorized.statusCode, 200);
  assert.match(authorized.body, /data-refresh-provider-token/);
  assert.match(authorized.body, /\/refresh-token/);
  assert.match(authorized.body, /Refreshing '\s*\+ provider \+ '\s*token\.\.\./);
});

test('admin ui rejects wrong credentials and missing same-origin protection', async (t) => {
  const Fastify = (await import('fastify')).default;
  const { default: errorHandlerPlugin } = await import('../plugins/error-handler.js');
  const { default: adminUiAuthPlugin } = await import('../plugins/admin-ui-auth.js');
  const { registerAdminUiRoutes } = await import('./admin-ui.js');

  const app = Fastify();
  await app.register(errorHandlerPlugin);
  await app.register(adminUiAuthPlugin);
  await registerAdminUiRoutes(app);

  t.after(async () => { await app.close(); });

  const loginPage = await app.inject({ method: 'GET', url: '/admin/login' });
  const loginFormToken = readHiddenInput(loginPage.body, 'formToken');

  const wrongPassword = await app.inject({
    method: 'POST',
    url: '/admin/login',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      host: 'localhost',
      origin: 'http://localhost',
    },
    payload: new URLSearchParams({
      formToken: loginFormToken,
      username: 'admin-user',
      password: 'wrong-pass',
    }).toString(),
  });

  assert.equal(wrongPassword.statusCode, 401);
  assert.match(wrongPassword.body, /Invalid username or password/);

  const missingOrigin = await app.inject({
    method: 'POST',
    url: '/admin/login',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      host: 'localhost',
    },
    payload: new URLSearchParams({
      formToken: loginFormToken,
      username: 'admin-user',
      password: 'admin-pass',
    }).toString(),
  });

  assert.equal(missingOrigin.statusCode, 403);
  assert.match(missingOrigin.body, /login form expired/i);
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
