import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import type { FastifyRequest } from 'fastify';
import { seedTestEnv } from '../../test-helpers.js';
import type { AuthActor } from '../../modules/auth/auth.types.js';

seedTestEnv();

type BootstrapDeps = { profileService: import('../../modules/profiles/profile-local.service.js').ProfileLocalService };

async function buildBootstrapApp(accountId: string, deps: BootstrapDeps) {
  const { default: errorHandlerPlugin } = await import('../plugins/error-handler.js');
  const { registerAccountBootstrapRoutes } = await import('./account-bootstrap.js');
  const app = Fastify();
  app.decorateRequest('auth');
  const auth: AuthActor = {
    type: 'user',
    appUserId: accountId,
    serviceId: null,
    scopes: [],
    authSubject: accountId,
    email: 'test@example.com',
    tokenId: null,
    consumerId: null,
    accessToken: null,
  };
  app.decorate('requireAuth', async (request: FastifyRequest) => {
    (request as FastifyRequest & { auth: AuthActor }).auth = { ...auth };
  });
  app.decorate('requireUserActor', (request: FastifyRequest) => (request as FastifyRequest & { auth: AuthActor }).auth as never);
  app.decorate('requireUserSessionActor', (request: FastifyRequest) => (request as FastifyRequest & { auth: AuthActor }).auth as never);
  app.decorate('requireScopes', () => {});
  await app.register(errorHandlerPlugin);
  await registerAccountBootstrapRoutes(app, deps);
  return app;
}

async function buildMeApp(accountId: string) {
  const { default: errorHandlerPlugin } = await import('../plugins/error-handler.js');
  const { registerMeRoutes } = await import('./me.js');
  const { ProfileLocalService } = await import('../../modules/profiles/profile-local.service.js');
  const { AccountSettingsService } = await import('../../modules/users/account-settings.service.js');
  const app = Fastify();
  app.decorateRequest('auth');
  const auth: AuthActor = {
    type: 'user',
    appUserId: accountId,
    serviceId: null,
    scopes: [],
    authSubject: accountId,
    email: 'test@example.com',
    tokenId: null,
    consumerId: null,
    accessToken: null,
  };
  app.decorate('requireAuth', async (request: FastifyRequest) => {
    (request as FastifyRequest & { auth: AuthActor }).auth = { ...auth };
  });
  app.decorate('requireUserActor', (request: FastifyRequest) => (request as FastifyRequest & { auth: AuthActor }).auth as never);
  app.decorate('requireUserSessionActor', (request: FastifyRequest) => (request as FastifyRequest & { auth: AuthActor }).auth as never);
  app.decorate('requireScopes', () => {});
  await app.register(errorHandlerPlugin);
  await registerMeRoutes(app, { profileService: new ProfileLocalService(), accountSettingsService: new AccountSettingsService() });
  return app;
}

const VALID_BODY = {
  name: 'Aayush',
  interfaceLanguage: 'en',
  avatarUrl: 'avatar_01',
};

test('bootstrap rejects a missing name with 400', async (t) => {
  const { ProfileLocalService } = await import('../../modules/profiles/profile-local.service.js');
  const app = await buildBootstrapApp('bs-name-1', { profileService: new ProfileLocalService() });
  t.after(async () => { await app.close(); });

  const res = await app.inject({
    method: 'POST',
    url: '/v1/account/bootstrap',
    headers: { authorization: 'Bearer test' },
    payload: { interfaceLanguage: 'en', avatarUrl: 'avatar_01' },
  });
  assert.equal(res.statusCode, 400);
});

test('bootstrap rejects an unsupported language with 400', async (t) => {
  const { ProfileLocalService } = await import('../../modules/profiles/profile-local.service.js');
  const app = await buildBootstrapApp('bs-lang-1', { profileService: new ProfileLocalService() });
  t.after(async () => { await app.close(); });

  const res = await app.inject({
    method: 'POST',
    url: '/v1/account/bootstrap',
    headers: { authorization: 'Bearer test' },
    payload: { ...VALID_BODY, interfaceLanguage: 'xx' },
  });
  assert.equal(res.statusCode, 400);
});

test('bootstrap rejects an unsupported avatar with 400', async (t) => {
  const { ProfileLocalService } = await import('../../modules/profiles/profile-local.service.js');
  const app = await buildBootstrapApp('bs-avatar-1', { profileService: new ProfileLocalService() });
  t.after(async () => { await app.close(); });

  const res = await app.inject({
    method: 'POST',
    url: '/v1/account/bootstrap',
    headers: { authorization: 'Bearer test' },
    payload: { ...VALID_BODY, avatarUrl: 'avatar_999' },
  });
  assert.equal(res.statusCode, 400);
});

test('bootstrap creates the primary profile as admin and non-kids', async (t) => {
  const { ProfileLocalService } = await import('../../modules/profiles/profile-local.service.js');
  const app = await buildBootstrapApp('bs-create-1', { profileService: new ProfileLocalService() });
  t.after(async () => { await app.close(); });

  const res = await app.inject({
    method: 'POST',
    url: '/v1/account/bootstrap',
    headers: { authorization: 'Bearer test' },
    payload: VALID_BODY,
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { data: { profile: Record<string, unknown>; created: boolean } };
  assert.equal(body.data.created, true);
  assert.equal(body.data.profile.name, 'Aayush');
  assert.equal(body.data.profile.isAdmin, true);
  assert.equal(body.data.profile.isKids, false);
  assert.equal(body.data.profile.avatarUrl, 'avatar_01');
  assert.equal(body.data.profile.interfaceLanguage, 'en');
});

test('bootstrap is idempotent and returns the existing profile on retry', async (t) => {
  const { ProfileLocalService } = await import('../../modules/profiles/profile-local.service.js');
  const app = await buildBootstrapApp('bs-idem-1', { profileService: new ProfileLocalService() });
  t.after(async () => { await app.close(); });

  const first = await app.inject({
    method: 'POST',
    url: '/v1/account/bootstrap',
    headers: { authorization: 'Bearer test' },
    payload: VALID_BODY,
  });
  const firstBody = first.json() as { data: { profile: { id: string }; created: boolean } };
  assert.equal(firstBody.data.created, true);

  const second = await app.inject({
    method: 'POST',
    url: '/v1/account/bootstrap',
    headers: { authorization: 'Bearer test' },
    payload: { ...VALID_BODY, name: 'Different Name' },
  });
  const secondBody = second.json() as { data: { profile: { id: string; name: string }; created: boolean } };
  assert.equal(second.statusCode, 200);
  assert.equal(secondBody.data.created, false);
  assert.equal(secondBody.data.profile.id, firstBody.data.profile.id);
  // Existing profile is not overwritten by a retried call.
  assert.equal(secondBody.data.profile.name, 'Aayush');
});

test('me route returns 409 signup_incomplete when the account has no profile', async (t) => {
  const app = await buildMeApp('me-noprofile-1');
  t.after(async () => { await app.close(); });

  const res = await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: 'Bearer test' } });
  assert.equal(res.statusCode, 409);
  const body = res.json() as { error: { code: string } };
  assert.equal(body.error.code, 'signup_incomplete');
});
