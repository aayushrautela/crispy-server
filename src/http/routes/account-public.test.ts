import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp, seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

test('GET /api/account/v1/account returns authenticated account with profiles', async (t) => {
  const { PublicAccountReadService } = await import('../../modules/account-public/public-account-read.service.js');
  
  const original = PublicAccountReadService.prototype.getAccount;
  t.after(() => {
    PublicAccountReadService.prototype.getAccount = original;
  });

  PublicAccountReadService.prototype.getAccount = async function () {
    return {
      id: 'user-1',
      email: 'test@example.com',
      createdAt: '2026-01-01T00:00:00.000Z',
      profiles: [
        {
          id: 'prof-1',
          name: 'Test Profile',
          avatarUrl: null,
          isDefault: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    } as never;
  };

  const { registerAccountPublicRoutes } = await import('./account-public.routes.js');
  const app = await buildTestApp(registerAccountPublicRoutes);
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'GET',
    url: '/api/account/v1/account',
    headers: { authorization: 'Bearer test' },
  });

  assert.equal(response.statusCode, 200);
  const payload = response.json() as { account: { id: string; profiles: unknown[] } };
  assert.equal(payload.account.id, 'user-1');
  assert.equal(payload.account.profiles.length, 1);
});

test('GET /api/account/v1/profiles returns visible profiles', async (t) => {
  const { PublicAccountReadService } = await import('../../modules/account-public/public-account-read.service.js');
  
  const original = PublicAccountReadService.prototype.listProfiles;
  t.after(() => {
    PublicAccountReadService.prototype.listProfiles = original;
  });

  PublicAccountReadService.prototype.listProfiles = async function () {
    return [
      {
        id: 'prof-1',
        name: 'Profile 1',
        avatarUrl: null,
        isDefault: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ] as never;
  };

  const { registerAccountPublicRoutes } = await import('./account-public.routes.js');
  const app = await buildTestApp(registerAccountPublicRoutes);
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'GET',
    url: '/api/account/v1/profiles',
    headers: { authorization: 'Bearer test' },
  });

  assert.equal(response.statusCode, 200);
  const payload = response.json() as { profiles: unknown[] };
  assert.equal(payload.profiles.length, 1);
});

test('GET /api/account/v1/profiles/:profileId returns profile detail', async (t) => {
  const { PublicAccountReadService } = await import('../../modules/account-public/public-account-read.service.js');
  
  const original = PublicAccountReadService.prototype.getProfile;
  t.after(() => {
    PublicAccountReadService.prototype.getProfile = original;
  });

  PublicAccountReadService.prototype.getProfile = async function () {
    return {
      id: 'prof-1',
      profileGroupId: 'pg-1',
      name: 'Test Profile',
      avatarUrl: null,
      isDefault: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as never;
  };

  const { registerAccountPublicRoutes } = await import('./account-public.routes.js');
  const app = await buildTestApp(registerAccountPublicRoutes);
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'GET',
    url: '/api/account/v1/profiles/prof-1',
    headers: { authorization: 'Bearer test' },
  });

  assert.equal(response.statusCode, 200);
  const payload = response.json() as { profile: { id: string; name: string } };
  assert.equal(payload.profile.id, 'prof-1');
  assert.equal(payload.profile.name, 'Test Profile');
});

test('GET /api/account/v1/profiles/:profileId/recent-watched returns empty list', async (t) => {
  const { PublicWatchReadService } = await import('../../modules/account-public/public-watch-read.service.js');
  
  const original = PublicWatchReadService.prototype.listRecentWatched;
  t.after(() => {
    PublicWatchReadService.prototype.listRecentWatched = original;
  });

  PublicWatchReadService.prototype.listRecentWatched = async function () {
    return [] as never;
  };

  const { registerAccountPublicRoutes } = await import('./account-public.routes.js');
  const app = await buildTestApp(registerAccountPublicRoutes);
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'GET',
    url: '/api/account/v1/profiles/prof-1/recent-watched',
    headers: { authorization: 'Bearer test' },
  });

  assert.equal(response.statusCode, 200);
  const payload = response.json() as { items: unknown[] };
  assert.equal(Array.isArray(payload.items), true);
});

test('GET /api/account/v1/profiles/:profileId/language-profile returns pending status', async (t) => {
  const { LanguageProfileReadService } = await import('../../modules/language-profile/language-profile-read.service.js');
  
  const original = LanguageProfileReadService.prototype.getForProfile;
  t.after(() => {
    LanguageProfileReadService.prototype.getForProfile = original;
  });

  LanguageProfileReadService.prototype.getForProfile = async function () {
    return {
      profileId: 'prof-1',
      status: 'pending',
      sampleSize: 0,
      windowSize: 50,
      computedAt: null,
      ratios: [],
      primaryLanguage: null,
    } as never;
  };

  const { registerAccountPublicRoutes } = await import('./account-public.routes.js');
  const app = await buildTestApp(registerAccountPublicRoutes);
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'GET',
    url: '/api/account/v1/profiles/prof-1/language-profile',
    headers: { authorization: 'Bearer test' },
  });

  assert.equal(response.statusCode, 200);
  const payload = response.json() as { languageProfile: { status: string } };
  assert.equal(payload.languageProfile.status, 'pending');
});

test('GET /api/account/v1/profiles/:profileId/taste/current returns null when no taste exists', async (t) => {
  const { PublicTasteReadService } = await import('../../modules/account-public/public-taste-read.service.js');
  
  const original = PublicTasteReadService.prototype.getCurrentForProfile;
  t.after(() => {
    PublicTasteReadService.prototype.getCurrentForProfile = original;
  });

  PublicTasteReadService.prototype.getCurrentForProfile = async function () {
    return null as never;
  };

  const { registerAccountPublicRoutes } = await import('./account-public.routes.js');
  const app = await buildTestApp(registerAccountPublicRoutes);
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'GET',
    url: '/api/account/v1/profiles/prof-1/taste/current',
    headers: { authorization: 'Bearer test' },
  });

  assert.equal(response.statusCode, 200);
  const payload = response.json() as { taste: null };
  assert.equal(payload.taste, null);
});
