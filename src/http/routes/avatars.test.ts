import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp } from '../../test-helpers.js';
import { registerAvatarRoutes } from './avatars.js';

test('GET /v1/avatars/:id serves a known avatar png with immutable cache', async (t) => {
  const app = await buildTestApp((a) => registerAvatarRoutes(a));
  t.after(async () => { await app.close(); });
  const res = await app.inject({ method: 'GET', url: '/v1/avatars/avatar_01' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'image/png');
  assert.equal(res.headers['cache-control'], 'public, max-age=31536000, immutable');
  assert.ok(res.rawPayload.length > 0);
});

test('GET /v1/avatars/:id rejects unknown ids with 404', async (t) => {
  const app = await buildTestApp((a) => registerAvatarRoutes(a));
  t.after(async () => { await app.close(); });
  const res = await app.inject({ method: 'GET', url: '/v1/avatars/not-a-real-id' });
  assert.equal(res.statusCode, 404);
});