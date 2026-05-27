import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp, seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

test('POST /v1/auth/app-login/handoff-codes creates one-time code', async (t) => {
  const { AppLoginHandoffService } = await import('../../modules/auth/app-login-handoff.service.js');
  const original = AppLoginHandoffService.prototype.createForUser;
  t.after(() => {
    AppLoginHandoffService.prototype.createForUser = original;
  });

  AppLoginHandoffService.prototype.createForUser = async function (authSubject, input) {
    assert.equal(authSubject, 'auth-subject');
    assert.equal(input.returnUri, 'crispy://auth/callback');
    return {
      code: {
        id: 'code-1',
        codePreview: 'cp_login_abc',
        returnUri: 'crispy://auth/callback',
        expiresAt: '2026-01-01T00:05:00.000Z',
        consumedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      plaintextCode: 'cp_login_abc123',
      redirectUri: 'crispy://auth/callback?code=cp_login_abc123',
    };
  };

  const { AppLoginHandoffService: Service } = await import('../../modules/auth/app-login-handoff.service.js');
  const { registerAuthHandoffRoutes } = await import('./auth-handoff.js');
  const app = await buildTestApp((app) => registerAuthHandoffRoutes(app, { appLoginHandoffService: new Service() }));
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/app-login/handoff-codes',
    headers: { authorization: 'Bearer test' },
    payload: { returnUri: 'crispy://auth/callback' },
  });

  assert.equal(response.statusCode, 201);
  const body = response.json() as { data: { plaintextCode: string; redirectUri: string; code: { consumedAt: string | null } } };
  assert.equal(body.data.plaintextCode, 'cp_login_abc123');
  assert.equal(body.data.redirectUri, 'crispy://auth/callback?code=cp_login_abc123');
  assert.equal(body.data.code.consumedAt, null);
});

test('POST /v1/auth/app-login/exchange exchanges code for app session token', async (t) => {
  const { AppLoginHandoffService } = await import('../../modules/auth/app-login-handoff.service.js');
  const original = AppLoginHandoffService.prototype.exchange;
  t.after(() => {
    AppLoginHandoffService.prototype.exchange = original;
  });

  AppLoginHandoffService.prototype.exchange = async function (input) {
    assert.equal(input.code, 'cp_login_abc123');
    assert.equal(input.deviceName, 'Pixel TV');
    return {
      token: {
        id: 'token-1',
        name: 'App session: Pixel TV',
        tokenPreview: 'cp_pat_abc12',
        scopes: ['profiles:read', 'watch:read'],
        expiresAt: '2026-04-01T00:00:00.000Z',
        lastUsedAt: null,
        revokedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      plaintextToken: 'cp_pat_abc123',
      user: {
        id: 'user-1',
        email: 'test@example.com',
      },
    };
  };

  const { AppLoginHandoffService: Service } = await import('../../modules/auth/app-login-handoff.service.js');
  const { registerAuthHandoffRoutes } = await import('./auth-handoff.js');
  const app = await buildTestApp((app) => registerAuthHandoffRoutes(app, { appLoginHandoffService: new Service() }));
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/app-login/exchange',
    payload: { code: 'cp_login_abc123', deviceName: 'Pixel TV' },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as { data: { plaintextToken: string; token: { tokenPreview: string }; user: { email: string } } };
  assert.equal(body.data.plaintextToken, 'cp_pat_abc123');
  assert.equal(body.data.token.tokenPreview, 'cp_pat_abc12');
  assert.equal(body.data.user.email, 'test@example.com');
});
