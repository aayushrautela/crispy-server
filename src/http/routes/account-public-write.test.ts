import { describe, test } from 'node:test';
import assert from 'node:assert';
import { buildTestApp, seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

describe('Public Account Write API', () => {
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

    const { registerAccountPublicRoutes } = await import('./account-public.routes.js');
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
    const body = response.json().data;
    assert.strictEqual(body.profileId, 'prof-1');
    assert.strictEqual(body.version, 1);
    assert.strictEqual(body.signalCount, 2);
    assert.strictEqual(body.created, true);
  });

  test('PUT /api/account/v1/profiles/:profileId/taste/current rejects too many signals', async (t) => {
    const { registerAccountPublicRoutes } = await import('./account-public.routes.js');
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

    const { registerAccountPublicRoutes } = await import('./account-public.routes.js');
    const app = await buildTestApp(registerAccountPublicRoutes);
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/account/v1/profiles/prof-1/taste/current',
    });

    assert.strictEqual(response.statusCode, 204);
  });
});
