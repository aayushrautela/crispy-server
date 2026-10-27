import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';

import { setTestEnv } from '../../test-helpers.js';

setTestEnv({
  ADMIN_UI_USER: 'admin',
  ADMIN_UI_PASSWORD: 'secret',
  ADMIN_UI_SESSION_SECRET: 'test-session-secret-that-is-long-enough',
});

test('classifyGlobalRateLimitRoute: admin login is limited (POST only)', async (t) => {
  const { classifyGlobalRateLimitRoute } = await import('./global-rate-limit.js');
  assert.deepEqual(classifyGlobalRateLimitRoute('POST', '/admin/login'), ['admin.login']);
  assert.deepEqual(classifyGlobalRateLimitRoute('GET', '/admin/login'), []);
});

test('classifyGlobalRateLimitRoute: PIN verify consumes pin + general buckets', async (t) => {
  const { classifyGlobalRateLimitRoute } = await import('./global-rate-limit.js');
  assert.deepEqual(classifyGlobalRateLimitRoute('POST', '/v1/profiles/prof-1/pin/verify'), ['v1.pin.verify', 'v1.api']);
});

test('classifyGlobalRateLimitRoute: PAT minting consumes pat + general buckets', async (t) => {
  const { classifyGlobalRateLimitRoute } = await import('./global-rate-limit.js');
  assert.deepEqual(classifyGlobalRateLimitRoute('POST', '/v1/auth/personal-access-tokens'), ['v1.pat.mint', 'v1.api']);
});

test('classifyGlobalRateLimitRoute: device-code endpoints consume device + general buckets', async (t) => {
  const { classifyGlobalRateLimitRoute } = await import('./global-rate-limit.js');
  assert.deepEqual(classifyGlobalRateLimitRoute('POST', '/v1/auth/device/authorize'), ['v1.device.code', 'v1.api']);
  assert.deepEqual(classifyGlobalRateLimitRoute('POST', '/v1/auth/device/token'), ['v1.device.code', 'v1.api']);
  assert.deepEqual(classifyGlobalRateLimitRoute('POST', '/v1/auth/device/verification'), ['v1.device.code', 'v1.api']);
  assert.deepEqual(classifyGlobalRateLimitRoute('POST', '/v1/auth/device/verification/approve'), ['v1.device.code', 'v1.api']);
  assert.deepEqual(classifyGlobalRateLimitRoute('POST', '/v1/auth/device/verification/deny'), ['v1.device.code', 'v1.api']);
});

test('classifyGlobalRateLimitRoute: general /v1 routes consume the api bucket', async (t) => {
  const { classifyGlobalRateLimitRoute } = await import('./global-rate-limit.js');
  assert.deepEqual(classifyGlobalRateLimitRoute('GET', '/v1/account/settings'), ['v1.api']);
  assert.deepEqual(classifyGlobalRateLimitRoute('GET', '/v1/profiles'), ['v1.api']);
});

test('classifyGlobalRateLimitRoute: ignores unrelated routes', async (t) => {
  const { classifyGlobalRateLimitRoute } = await import('./global-rate-limit.js');
  assert.deepEqual(classifyGlobalRateLimitRoute('GET', '/health'), []);
  assert.deepEqual(classifyGlobalRateLimitRoute('GET', '/admin/login'), []);
  assert.deepEqual(classifyGlobalRateLimitRoute('POST', '/v1/auth/personal-access-tokens/abc'), ['v1.api']);
});

test('global rate limit returns 429 + Retry-After on admin login', async (t) => {
  const { redis } = await import('../../lib/redis.js');
  const { RedisRateLimitStore } = await import('../../lib/rate-limit.store.js');
  const { default: errorHandlerPlugin } = await import('../../http/plugins/error-handler.js');
  const { default: adminUiAuthPlugin } = await import('../../http/plugins/admin-ui-auth.js');
  const { default: globalRateLimitPlugin } = await import('./global-rate-limit.js');
  const { registerAdminUiRoutes } = await import('../../http/routes/admin-ui.js');
  const { SystemClock } = await import('../../modules/apps/clock.js');

  const store = new RedisRateLimitStore(redis);
  const app = Fastify();
  await app.register(errorHandlerPlugin);
  await app.register(adminUiAuthPlugin);
  await app.register(globalRateLimitPlugin, { store, clock: new SystemClock() });
  await registerAdminUiRoutes(app);
  await app.ready();
  t.after(async () => { await app.close(); });

  for (let i = 0; i < 10; i += 1) {
    await app.inject({
      method: 'POST',
      url: '/admin/login',
      headers: { 'content-type': 'application/x-www-form-urlencoded', host: '127.0.0.1:80', origin: 'http://127.0.0.1:80' },
      payload: 'username=admin&password=secret&formToken=x',
    });
  }

  const response = await app.inject({
    method: 'POST',
    url: '/admin/login',
    headers: { 'content-type': 'application/x-www-form-urlencoded', host: '127.0.0.1:80', origin: 'http://127.0.0.1:80' },
    payload: 'username=admin&password=secret&formToken=x',
  });

  assert.equal(response.statusCode, 429);
  assert.ok(response.headers['retry-after']);
  const body = response.json();
  assert.equal(body.error.code, 'RATE_LIMIT_EXCEEDED');
  assert.equal(body.error.category, 'rate_limit');
  assert.equal(body.error.retryable, true);
});
