import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp, seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

test('POST /v1/auth/device/authorize creates device authorization', async (t) => {
  const { DeviceAuthorizationService } = await import('../../modules/auth/device-authorization.service.js');
  const original = DeviceAuthorizationService.prototype.createAuthorization;
  t.after(() => {
    DeviceAuthorizationService.prototype.createAuthorization = original;
  });

  DeviceAuthorizationService.prototype.createAuthorization = async function (this: unknown, input: { clientId: string }) {
    assert.equal(input.clientId, 'crispy-tv');
    return {
      deviceCode: 'cp_dvc_abc123',
      userCode: 'WDJB-MJHT',
      verificationUri: 'https://api.crispytv.tech/device',
      verificationUriComplete: 'https://api.crispytv.tech/device?user_code=WDJB-MJHT',
      expiresIn: 900,
      interval: 5,
    };
  };

  const { DeviceAuthorizationService: Service } = await import('../../modules/auth/device-authorization.service.js');
  const { registerAuthDeviceRoutes } = await import('./auth-device.js');
  const app = await buildTestApp((app) => registerAuthDeviceRoutes(app, { deviceAuthorizationService: new Service() }));
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/device/authorize',
    payload: { clientId: 'crispy-tv', deviceName: 'Living Room TV' },
  });

  assert.equal(response.statusCode, 201);
  const body = response.json() as { data: { deviceCode: string; userCode: string; verificationUri: string; verificationUriComplete: string; expiresIn: number; interval: number } };
  assert.equal(body.data.deviceCode, 'cp_dvc_abc123');
  assert.equal(body.data.userCode, 'WDJB-MJHT');
  assert.equal(body.data.verificationUri, 'https://api.crispytv.tech/device');
  assert.equal(body.data.verificationUriComplete, 'https://api.crispytv.tech/device?user_code=WDJB-MJHT');
  assert.equal(body.data.expiresIn, 900);
  assert.equal(body.data.interval, 5);
});

test('POST /v1/auth/device/authorize rejects unknown client', async (t) => {
  const { DeviceAuthorizationService } = await import('../../modules/auth/device-authorization.service.js');
  const original = DeviceAuthorizationService.prototype.createAuthorization;
  t.after(() => {
    DeviceAuthorizationService.prototype.createAuthorization = original;
  });

  DeviceAuthorizationService.prototype.createAuthorization = async function () {
    throw Object.assign(new Error('Unknown client ID.'), { statusCode: 400, code: 'invalid_client_id' });
  };

  const { DeviceAuthorizationService: Service } = await import('../../modules/auth/device-authorization.service.js');
  const { registerAuthDeviceRoutes } = await import('./auth-device.js');
  const app = await buildTestApp((app) => registerAuthDeviceRoutes(app, { deviceAuthorizationService: new Service() }));
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/device/authorize',
    payload: { clientId: 'crispy-web' },
  });

  assert.equal(response.statusCode, 400);
});

test('POST /v1/auth/device/token returns authorization_pending', async (t) => {
  const { DeviceAuthorizationService } = await import('../../modules/auth/device-authorization.service.js');
  const original = DeviceAuthorizationService.prototype.poll;
  t.after(() => {
    DeviceAuthorizationService.prototype.poll = original;
  });

  DeviceAuthorizationService.prototype.poll = async function (this: unknown, input: { deviceCode: string }) {
    assert.equal(input.deviceCode, 'cp_dvc_abc123');
    return { kind: 'authorization_pending' };
  };

  const { DeviceAuthorizationService: Service } = await import('../../modules/auth/device-authorization.service.js');
  const { registerAuthDeviceRoutes } = await import('./auth-device.js');
  const app = await buildTestApp((app) => registerAuthDeviceRoutes(app, { deviceAuthorizationService: new Service() }));
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/device/token',
    payload: { deviceCode: 'cp_dvc_abc123' },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as { data: { status: string } };
  assert.equal(body.data.status, 'authorization_pending');
});

test('POST /v1/auth/device/token returns approved token payload', async (t) => {
  const { DeviceAuthorizationService } = await import('../../modules/auth/device-authorization.service.js');
  const original = DeviceAuthorizationService.prototype.poll;
  t.after(() => {
    DeviceAuthorizationService.prototype.poll = original;
  });

  DeviceAuthorizationService.prototype.poll = async function () {
    return {
      kind: 'approved',
      plaintextToken: 'cp_pat_abc123',
      token: {
        id: 'token-1',
        name: 'TV session: Living Room TV',
        tokenPreview: 'cp_pat_abc12',
        scopes: ['profiles:read', 'watch:read'],
        expiresAt: '2026-12-01T00:00:00.000Z',
        createdAt: '2026-09-08T00:00:00.000Z',
      },
      user: { id: 'user-1', email: 'test@example.com' },
    };
  };

  const { DeviceAuthorizationService: Service } = await import('../../modules/auth/device-authorization.service.js');
  const { registerAuthDeviceRoutes } = await import('./auth-device.js');
  const app = await buildTestApp((app) => registerAuthDeviceRoutes(app, { deviceAuthorizationService: new Service() }));
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/device/token',
    payload: { deviceCode: 'cp_dvc_abc123' },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as { data: { status: string; plaintextToken: string; token: { tokenPreview: string }; user: { email: string } } };
  assert.equal(body.data.status, 'approved');
  assert.equal(body.data.plaintextToken, 'cp_pat_abc123');
  assert.equal(body.data.token.tokenPreview, 'cp_pat_abc12');
  assert.equal(body.data.user.email, 'test@example.com');
});

test('POST /v1/auth/device/verification requires auth and looks up code', async (t) => {
  const { DeviceAuthorizationService } = await import('../../modules/auth/device-authorization.service.js');
  const originalLookup = DeviceAuthorizationService.prototype.lookupForApproval;
  t.after(() => {
    DeviceAuthorizationService.prototype.lookupForApproval = originalLookup;
  });

  DeviceAuthorizationService.prototype.lookupForApproval = async function (this: unknown, userId: string, input: { userCode: string }) {
    assert.equal(userId, 'auth-subject');
    // Raw input is passed through; normalization happens inside the service.
    assert.equal(input.userCode, 'wdjb-mjht');
    return { clientId: 'crispy-tv', deviceName: 'Living Room TV', expiresAt: '2026-09-08T01:00:00.000Z' };
  };

  const { DeviceAuthorizationService: Service } = await import('../../modules/auth/device-authorization.service.js');
  const { registerAuthDeviceRoutes } = await import('./auth-device.js');
  const app = await buildTestApp((app) => registerAuthDeviceRoutes(app, { deviceAuthorizationService: new Service() }));
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/device/verification',
    headers: { authorization: 'Bearer test' },
    payload: { userCode: 'wdjb-mjht' },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as { data: { clientId: string; deviceName: string } };
  assert.equal(body.data.clientId, 'crispy-tv');
  assert.equal(body.data.deviceName, 'Living Room TV');
});

test('POST /v1/auth/device/verification/approve approves device', async (t) => {
  const { DeviceAuthorizationService } = await import('../../modules/auth/device-authorization.service.js');
  const original = DeviceAuthorizationService.prototype.approve;
  t.after(() => {
    DeviceAuthorizationService.prototype.approve = original;
  });

  DeviceAuthorizationService.prototype.approve = async function (this: unknown, userId: string) {
    assert.equal(userId, 'auth-subject');
    return { clientId: 'crispy-tv', deviceName: 'Living Room TV', expiresAt: '2026-09-08T01:00:00.000Z' };
  };

  const { DeviceAuthorizationService: Service } = await import('../../modules/auth/device-authorization.service.js');
  const { registerAuthDeviceRoutes } = await import('./auth-device.js');
  const app = await buildTestApp((app) => registerAuthDeviceRoutes(app, { deviceAuthorizationService: new Service() }));
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/device/verification/approve',
    headers: { authorization: 'Bearer test' },
    payload: { userCode: 'WDJB-MJHT' },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as { data: { clientId: string } };
  assert.equal(body.data.clientId, 'crispy-tv');
});

test('POST /v1/auth/device/verification/deny denies device', async (t) => {
  const { DeviceAuthorizationService } = await import('../../modules/auth/device-authorization.service.js');
  const original = DeviceAuthorizationService.prototype.deny;
  t.after(() => {
    DeviceAuthorizationService.prototype.deny = original;
  });

  DeviceAuthorizationService.prototype.deny = async function (input: { userCode: string }) {
    assert.equal(input.userCode, 'WDJB-MJHT');
    return { clientId: 'crispy-tv', deviceName: 'Living Room TV', expiresAt: '2026-09-08T01:00:00.000Z' };
  };

  const { DeviceAuthorizationService: Service } = await import('../../modules/auth/device-authorization.service.js');
  const { registerAuthDeviceRoutes } = await import('./auth-device.js');
  const app = await buildTestApp((app) => registerAuthDeviceRoutes(app, { deviceAuthorizationService: new Service() }));
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/device/verification/deny',
    headers: { authorization: 'Bearer test' },
    payload: { userCode: 'WDJB-MJHT' },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as { data: { clientId: string } };
  assert.equal(body.data.clientId, 'crispy-tv');
});
