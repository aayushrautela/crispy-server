import { describe, test, mock } from 'node:test';
import assert from 'node:assert';
import { buildTestApp } from '../../test-helpers.js';
import { registerAccountPublicRoutes } from './account-public.routes.js';

describe('Public Account Write API', () => {
  test('PUT /api/account/v1/profiles/:profileId/recommendations/:listKey creates recommendation list', async (t) => {
    const { PublicAccountWriteService } = await import('../../modules/account-public/public-account-write.service.js');
    const original = PublicAccountWriteService.prototype.replaceRecommendationList;
    t.after(() => {
      PublicAccountWriteService.prototype.replaceRecommendationList = original;
    });

    PublicAccountWriteService.prototype.replaceRecommendationList = async function () {
      return {
        response: {
          profileId: 'prof-1',
          listKey: 'external:test',
          source: 'account_api',
          version: 1,
          itemCount: 2,
          created: true,
          updatedAt: '2026-01-01T00:00:00.000Z',
          etag: '"1"',
        },
        created: true,
        version: 1,
        etag: '"1"',
        status: 201,
      } as never;
    };

    const app = await buildTestApp(registerAccountPublicRoutes);
    const response = await app.inject({
      method: 'PUT',
      url: '/api/account/v1/profiles/prof-1/recommendations/external:test',
      payload: {
        schemaVersion: '2026-04-01',
        mediaType: 'track',
        items: [
          { provider: 'spotify', providerItemId: 'spotify:track:123', mediaType: 'track', title: 'Test Track' },
          { provider: 'spotify', providerItemId: 'spotify:track:456', mediaType: 'track', title: 'Test Track 2' },
        ],
      },
    });

    assert.strictEqual(response.statusCode, 201);
    const body = response.json();
    assert.strictEqual(body.profileId, 'prof-1');
    assert.strictEqual(body.listKey, 'external:test');
    assert.strictEqual(body.version, 1);
    assert.strictEqual(body.itemCount, 2);
    assert.strictEqual(body.created, true);
  });

  test('PUT /api/account/v1/profiles/:profileId/recommendations/:listKey rejects protected list key', async (t) => {
    const app = await buildTestApp(registerAccountPublicRoutes);
    const response = await app.inject({
      method: 'PUT',
      url: '/api/account/v1/profiles/prof-1/recommendations/reco:internal',
      payload: {
        schemaVersion: '2026-04-01',
        mediaType: 'track',
        items: [{ provider: 'spotify', providerItemId: 'spotify:track:123', mediaType: 'track' }],
      },
    });

    assert.strictEqual(response.statusCode, 400);
    const body = response.json();
    assert.strictEqual(body.code, 'PROTECTED_RECOMMENDATION_LIST');
  });

  test('PUT /api/account/v1/profiles/:profileId/recommendations/:listKey rejects invalid list key', async (t) => {
    const app = await buildTestApp(registerAccountPublicRoutes);
    const response = await app.inject({
      method: 'PUT',
      url: '/api/account/v1/profiles/prof-1/recommendations/invalid-key',
      payload: {
        schemaVersion: '2026-04-01',
        mediaType: 'track',
        items: [{ provider: 'spotify', providerItemId: 'spotify:track:123', mediaType: 'track' }],
      },
    });

    assert.strictEqual(response.statusCode, 400);
    const body = response.json();
    assert.strictEqual(body.code, 'INVALID_LIST_KEY');
  });

  test('PUT /api/account/v1/profiles/:profileId/recommendations/:listKey rejects too many items', async (t) => {
    const app = await buildTestApp(registerAccountPublicRoutes);
    const items = Array.from({ length: 501 }, (_, i) => ({
      provider: 'spotify',
      providerItemId: `spotify:track:${i}`,
      mediaType: 'track',
    }));

    const response = await app.inject({
      method: 'PUT',
      url: '/api/account/v1/profiles/prof-1/recommendations/external:test',
      payload: { schemaVersion: '2026-04-01', mediaType: 'track', items },
    });

    assert.strictEqual(response.statusCode, 400);
  });

  test('PUT /api/account/v1/profiles/:profileId/recommendations/:listKey rejects unknown fields', async (t) => {
    const app = await buildTestApp(registerAccountPublicRoutes);
    const response = await app.inject({
      method: 'PUT',
      url: '/api/account/v1/profiles/prof-1/recommendations/external:test',
      payload: {
        schemaVersion: '2026-04-01',
        mediaType: 'track',
        items: [{ provider: 'spotify', providerItemId: 'spotify:track:123', mediaType: 'track' }],
        unknownField: 'value',
      },
    });

    assert.strictEqual(response.statusCode, 400);
  });

  test('DELETE /api/account/v1/profiles/:profileId/recommendations/:listKey clears list', async (t) => {
    const { PublicAccountWriteService } = await import('../../modules/account-public/public-account-write.service.js');
    const original = PublicAccountWriteService.prototype.clearRecommendationList;
    t.after(() => {
      PublicAccountWriteService.prototype.clearRecommendationList = original;
    });

    PublicAccountWriteService.prototype.clearRecommendationList = async function () {
      return { response: null, created: false, version: 1, etag: '', status: 204 } as never;
    };

    const app = await buildTestApp(registerAccountPublicRoutes);
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/account/v1/profiles/prof-1/recommendations/external:test',
    });

    assert.strictEqual(response.statusCode, 204);
  });

  test('PUT /api/account/v1/profiles/:profileId/taste/current creates taste profile', async (t) => {
    const { PublicAccountWriteService } = await import('../../modules/account-public/public-account-write.service.js');
    const original = PublicAccountWriteService.prototype.replaceTasteProfile;
    t.after(() => {
      PublicAccountWriteService.prototype.replaceTasteProfile = original;
    });

    PublicAccountWriteService.prototype.replaceTasteProfile = async function () {
      return {
        response: {
          profileId: 'prof-1',
          source: 'account_api',
          version: 1,
          signalCount: 2,
          created: true,
          updatedAt: '2026-01-01T00:00:00.000Z',
          etag: '"1"',
        },
        created: true,
        version: 1,
        etag: '"1"',
        status: 201,
      } as never;
    };

    const app = await buildTestApp(registerAccountPublicRoutes);
    const response = await app.inject({
      method: 'PUT',
      url: '/api/account/v1/profiles/prof-1/taste/current',
      payload: {
        schemaVersion: '2026-04-01',
        signals: [
          { kind: 'genre', key: 'rock', weight: 0.8 },
          { kind: 'genre', key: 'pop', weight: 0.6 },
        ],
      },
    });

    assert.strictEqual(response.statusCode, 201);
    const body = response.json();
    assert.strictEqual(body.profileId, 'prof-1');
    assert.strictEqual(body.version, 1);
    assert.strictEqual(body.signalCount, 2);
    assert.strictEqual(body.created, true);
  });

  test('PUT /api/account/v1/profiles/:profileId/taste/current rejects too many signals', async (t) => {
    const app = await buildTestApp(registerAccountPublicRoutes);
    const signals = Array.from({ length: 251 }, (_, i) => ({ kind: 'genre', key: `genre-${i}`, weight: 0.5 }));

    const response = await app.inject({
      method: 'PUT',
      url: '/api/account/v1/profiles/prof-1/taste/current',
      payload: { schemaVersion: '2026-04-01', signals },
    });

    assert.strictEqual(response.statusCode, 400);
  });

  test('DELETE /api/account/v1/profiles/:profileId/taste/current clears taste', async (t) => {
    const { PublicAccountWriteService } = await import('../../modules/account-public/public-account-write.service.js');
    const original = PublicAccountWriteService.prototype.clearTasteProfile;
    t.after(() => {
      PublicAccountWriteService.prototype.clearTasteProfile = original;
    });

    PublicAccountWriteService.prototype.clearTasteProfile = async function () {
      return { response: null, created: false, version: 1, etag: '', status: 204 } as never;
    };

    const app = await buildTestApp(registerAccountPublicRoutes);
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/account/v1/profiles/prof-1/taste/current',
    });

    assert.strictEqual(response.statusCode, 204);
  });

  test('PUT with Idempotency-Key returns same response on replay', async (t) => {
    const { PublicAccountWriteService } = await import('../../modules/account-public/public-account-write.service.js');
    const original = PublicAccountWriteService.prototype.replaceRecommendationList;
    let callCount = 0;
    t.after(() => {
      PublicAccountWriteService.prototype.replaceRecommendationList = original;
    });

    PublicAccountWriteService.prototype.replaceRecommendationList = async function () {
      callCount++;
      return {
        response: {
          profileId: 'prof-1',
          listKey: 'external:test',
          source: 'account_api',
          version: 1,
          itemCount: 1,
          created: callCount === 1,
          updatedAt: '2026-01-01T00:00:00.000Z',
          etag: '"1"',
        },
        created: callCount === 1,
        version: 1,
        etag: '"1"',
        status: callCount === 1 ? 201 : 200,
      } as never;
    };

    const app = await buildTestApp(registerAccountPublicRoutes);
    const payload = {
      schemaVersion: '2026-04-01',
      mediaType: 'track',
      items: [{ provider: 'spotify', providerItemId: 'spotify:track:123', mediaType: 'track' }],
    };

    const response1 = await app.inject({
      method: 'PUT',
      url: '/api/account/v1/profiles/prof-1/recommendations/external:test',
      headers: { 'idempotency-key': 'test-key-123' },
      payload,
    });

    assert.strictEqual(response1.statusCode, 201);
    assert.strictEqual(callCount, 1);
  });
});
