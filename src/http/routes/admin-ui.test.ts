import test from 'node:test';
import assert from 'node:assert/strict';
import { setTestEnv } from '../../test-helpers.js';

setTestEnv({
  ADMIN_UI_USER: 'admin-user',
  ADMIN_UI_PASSWORD: 'admin-pass',
  SERVICE_CLIENTS_JSON: '[]',
});

test('admin ui requires basic auth and serves html when authorized', async (t) => {
  const Fastify = (await import('fastify')).default;
  const { default: errorHandlerPlugin } = await import('../plugins/error-handler.js');
  const { default: adminUiAuthPlugin } = await import('../plugins/admin-ui-auth.js');
  const { registerAdminUiRoutes } = await import('./admin-ui.js');

  const app = Fastify();
  await app.register(errorHandlerPlugin);
  await app.register(adminUiAuthPlugin);
  await registerAdminUiRoutes(app);

  t.after(async () => { await app.close(); });

  const unauthorized = await app.inject({ method: 'GET', url: '/admin' });
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(unauthorized.headers['www-authenticate'], 'Basic realm="Crispy Admin"');

  const authorized = await app.inject({
    method: 'GET',
    url: '/admin',
    headers: { authorization: `Basic ${Buffer.from('admin-user:admin-pass').toString('base64')}` },
  });

  assert.equal(authorized.statusCode, 200);
  assert.match(String(authorized.headers['content-type']), /text\/html/);
  assert.match(authorized.body, /Crispy Control Plane/);
});

test('admin ui rejects wrong credentials', async (t) => {
  const Fastify = (await import('fastify')).default;
  const { default: errorHandlerPlugin } = await import('../plugins/error-handler.js');
  const { default: adminUiAuthPlugin } = await import('../plugins/admin-ui-auth.js');
  const { registerAdminUiRoutes } = await import('./admin-ui.js');

  const app = Fastify();
  await app.register(errorHandlerPlugin);
  await app.register(adminUiAuthPlugin);
  await registerAdminUiRoutes(app);

  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'GET',
    url: '/admin',
    headers: { authorization: `Basic ${Buffer.from('admin-user:wrong-pass').toString('base64')}` },
  });

  assert.equal(response.statusCode, 401);
});
