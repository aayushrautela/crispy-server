import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp, seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

test('GET /v1/account/addons returns empty list when no addons installed', async (t) => {
  const { AddonService } = await import('../../modules/users/addon.service.js');
  const { registerAddonRoutes } = await import('./addons.js');

  const originalListAddons = AddonService.prototype.listAddons;
  t.after(() => { AddonService.prototype.listAddons = originalListAddons; });
  AddonService.prototype.listAddons = async function () { return { addons: [] }; };

  const app = await buildTestApp((app) => registerAddonRoutes(app, {
    addonService: new AddonService(),
  }));
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/account/addons',
    headers: { authorization: 'Bearer test' },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.deepEqual(body.data.addons, []);
});

test('POST /v1/account/addons with valid URL creates addon', async (t) => {
  const { AddonService } = await import('../../modules/users/addon.service.js');
  const { registerAddonRoutes } = await import('./addons.js');

  const originalAddAddon = AddonService.prototype.addAddon;
  t.after(() => { AddonService.prototype.addAddon = originalAddAddon; });
  AddonService.prototype.addAddon = async function (_accountId, input) {
    return { id: 'addon-1', accountId: 'acc-1', type: 'stremio' as const, manifestUrl: String(input.manifestUrl), payload: {}, createdAt: '2024-01-01T00:00:00.000Z' };
  };

  const app = await buildTestApp((app) => registerAddonRoutes(app, {
    addonService: new AddonService(),
    adminProfileLookup: async (profileId, authSubject) => ({
      id: profileId, accountId: authSubject, isAdmin: true, hasPin: false,
    }),
  }));
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'POST',
    url: '/v1/account/addons',
    headers: { authorization: 'Bearer test', 'x-profile-id': 'admin-profile' },
    payload: { manifestUrl: 'https://example.com/manifest.json' },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.data.addon.manifestUrl, 'https://example.com/manifest.json');
  assert.equal(body.data.addon.type, 'stremio');
});

test('POST /v1/account/addons creates jsplugin addon with payload', async (t) => {
  const { AddonService } = await import('../../modules/users/addon.service.js');
  const { registerAddonRoutes } = await import('./addons.js');

  const originalAddAddon = AddonService.prototype.addAddon;
  t.after(() => { AddonService.prototype.addAddon = originalAddAddon; });
  AddonService.prototype.addAddon = async function (_accountId, input) {
    return {
      id: 'addon-2',
      accountId: 'acc-1',
      type: input.type === 'jsplugin' ? 'jsplugin' : 'stremio',
      manifestUrl: String(input.manifestUrl),
      payload: (typeof input.payload === 'object' && input.payload !== null ? input.payload : {}) as { providerId: string; name?: string; version?: string },
      createdAt: '2024-01-01T00:00:00.000Z',
    };
  };

  const app = await buildTestApp((app) => registerAddonRoutes(app, {
    addonService: new AddonService(),
    adminProfileLookup: async (profileId, authSubject) => ({
      id: profileId, accountId: authSubject, isAdmin: true, hasPin: false,
    }),
  }));
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'POST',
    url: '/v1/account/addons',
    headers: { authorization: 'Bearer test', 'x-profile-id': 'admin-profile' },
    payload: {
      manifestUrl: 'https://example.com/repo.json',
      type: 'jsplugin',
      payload: { providerId: 'example-provider', name: 'Example', version: '1.0.0' },
    },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.data.addon.type, 'jsplugin');
  assert.equal(body.data.addon.payload.providerId, 'example-provider');
  assert.equal(body.data.addon.payload.name, 'Example');
  assert.equal(body.data.addon.payload.version, '1.0.0');
});

test('POST /v1/account/addons jsplugin payload without providerId returns 400', async (t) => {
  const { AddonService } = await import('../../modules/users/addon.service.js');
  const { registerAddonRoutes } = await import('./addons.js');

  const app = await buildTestApp((app) => registerAddonRoutes(app, {
    addonService: new AddonService(),
    adminProfileLookup: async (profileId, authSubject) => ({
      id: profileId, accountId: authSubject, isAdmin: true, hasPin: false,
    }),
  }));
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'POST',
    url: '/v1/account/addons',
    headers: { authorization: 'Bearer test', 'x-profile-id': 'admin-profile' },
    payload: {
      manifestUrl: 'https://example.com/repo.json',
      type: 'jsplugin',
      payload: { name: 'Example' },
    },
  });

  assert.equal(response.statusCode, 400);
});

test('POST /v1/account/addons without admin returns 403', async (t) => {
  const { AddonService } = await import('../../modules/users/addon.service.js');
  const { registerAddonRoutes } = await import('./addons.js');

  const app = await buildTestApp((app) => registerAddonRoutes(app, {
    addonService: new AddonService(),
    adminProfileLookup: async (profileId, authSubject) => ({
      id: profileId, accountId: authSubject, isAdmin: false, hasPin: false,
    }),
  }));
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'POST',
    url: '/v1/account/addons',
    headers: { authorization: 'Bearer test', 'x-profile-id': 'non-admin-profile' },
    payload: { manifestUrl: 'https://example.com/manifest.json' },
  });

  assert.equal(response.statusCode, 403);
});

test('POST /v1/account/addons with missing manifestUrl returns 400', async (t) => {
  const { AddonService } = await import('../../modules/users/addon.service.js');
  const { registerAddonRoutes } = await import('./addons.js');

  const originalAddAddon = AddonService.prototype.addAddon;
  t.after(() => { AddonService.prototype.addAddon = originalAddAddon; });
  AddonService.prototype.addAddon = async function (_accountId, _manifestUrl) {
    const { HttpError } = await import('../../lib/errors.js');
    throw new HttpError(400, 'manifestUrl is required.');
  };

  const app = await buildTestApp((app) => registerAddonRoutes(app, {
    addonService: new AddonService(),
    adminProfileLookup: async (profileId, authSubject) => ({
      id: profileId, accountId: authSubject, isAdmin: true, hasPin: false,
    }),
  }));
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'POST',
    url: '/v1/account/addons',
    headers: { authorization: 'Bearer test', 'x-profile-id': 'admin-profile' },
    payload: {},
  });

  assert.equal(response.statusCode, 400);
});

test('POST /v1/account/addons duplicate install returns existing addon (idempotent)', async (t) => {
  const { AddonService } = await import('../../modules/users/addon.service.js');
  const { registerAddonRoutes } = await import('./addons.js');

  const originalAddAddon = AddonService.prototype.addAddon;
  t.after(() => { AddonService.prototype.addAddon = originalAddAddon; });
  AddonService.prototype.addAddon = async function () {
    return {
      id: 'addon-existing',
      accountId: 'acc-1',
      type: 'stremio' as const,
      manifestUrl: 'https://example.com/manifest.json',
      payload: {},
      createdAt: '2024-01-01T00:00:00.000Z',
    };
  };

  const app = await buildTestApp((app) => registerAddonRoutes(app, {
    addonService: new AddonService(),
    adminProfileLookup: async (profileId, authSubject) => ({
      id: profileId, accountId: authSubject, isAdmin: true, hasPin: false,
    }),
  }));
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'POST',
    url: '/v1/account/addons',
    headers: { authorization: 'Bearer test', 'x-profile-id': 'admin-profile' },
    payload: { manifestUrl: 'https://example.com/manifest.json' },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.data.addon.id, 'addon-existing');
});

test('DELETE /v1/account/addons/:addonId removes addon', async (t) => {
  const { AddonService } = await import('../../modules/users/addon.service.js');
  const { registerAddonRoutes } = await import('./addons.js');

  const originalRemoveAddon = AddonService.prototype.removeAddon;
  t.after(() => { AddonService.prototype.removeAddon = originalRemoveAddon; });
  AddonService.prototype.removeAddon = async function () { return { deleted: true }; };

  const app = await buildTestApp((app) => registerAddonRoutes(app, {
    addonService: new AddonService(),
    adminProfileLookup: async (profileId, authSubject) => ({
      id: profileId, accountId: authSubject, isAdmin: true, hasPin: false,
    }),
  }));
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'DELETE',
    url: '/v1/account/addons/addon-1',
    headers: { authorization: 'Bearer test', 'x-profile-id': 'admin-profile' },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.data.deleted, true);
});

test('DELETE /v1/account/addons/:addonId without admin returns 403', async (t) => {
  const { AddonService } = await import('../../modules/users/addon.service.js');
  const { registerAddonRoutes } = await import('./addons.js');

  const app = await buildTestApp((app) => registerAddonRoutes(app, {
    addonService: new AddonService(),
    adminProfileLookup: async (profileId, authSubject) => ({
      id: profileId, accountId: authSubject, isAdmin: false, hasPin: false,
    }),
  }));
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'DELETE',
    url: '/v1/account/addons/addon-1',
    headers: { authorization: 'Bearer test', 'x-profile-id': 'non-admin-profile' },
  });

  assert.equal(response.statusCode, 403);
});
