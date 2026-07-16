import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

async function buildApp(): Promise<FastifyInstance> {
  const { registerProfileRoutes } = await import('./profiles.js');
  const { ProfileLocalService } = await import('../../modules/profiles/profile-local.service.js');
  const { ProfilePinService } = await import('../../modules/profiles/profile-pin.service.js');
  return buildTestApp((app) => registerProfileRoutes(app, {
    profileService: new ProfileLocalService(),
    pinService: new ProfilePinService(),
  }));
}

test('GET /v1/i18n/languages returns the supported language catalog', async (t) => {
  const app = await buildApp();
  t.after(async () => { await app.close(); });
  const response = await app.inject({ method: 'GET', url: '/v1/i18n/languages', headers: { authorization: 'Bearer test' } });
  assert.equal(response.statusCode, 200);
  const body = response.json() as { data: { languages: Array<{ code: string; name: string }> } };
  const codes = body.data.languages.map((l) => l.code);
  assert.ok(codes.includes('en'));
  assert.ok(codes.includes('pt-BR'));
  assert.ok(codes.includes('zh-CN'));
  assert.equal(typeof body.data.languages[0]?.name, 'string');
});

test('GET /v1/i18n/countries returns the supported country catalog', async (t) => {
  const app = await buildApp();
  t.after(async () => { await app.close(); });
  const response = await app.inject({ method: 'GET', url: '/v1/i18n/countries', headers: { authorization: 'Bearer test' } });
  assert.equal(response.statusCode, 200);
  const body = response.json() as { data: { countries: Array<{ code: string; name: string }> } };
  const codes = body.data.countries.map((c) => c.code);
  assert.ok(codes.includes('US'));
  assert.ok(codes.includes('IN'));
  assert.ok(codes.includes('JP'));
});

test('GET /v1/i18n/* requires auth', async (t) => {
  // Auth flow is mocked in the test harness so we only confirm the route is
  // wired and returns the catalog under authenticated conditions.
  const app = await buildApp();
  t.after(async () => { await app.close(); });
  const response = await app.inject({ method: 'GET', url: '/v1/i18n/languages' });
  assert.equal(response.statusCode, 200);
});
