import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { seedTestEnv } from '../../test-helpers.js';
import type { HomeMode } from './homescreen.types.js';

seedTestEnv();

const { isHomeMode } = await import('./homescreen.types.js');
const { buildSectionProviders } = await import('./section-provider-registry.js');
const { HomeModeService } = await import('./home-mode.service.js');

describe('homescreen type guards', () => {
  it('isHomeMode accepts only recommended/custom', () => {
    assert.equal(isHomeMode('recommended'), true);
    assert.equal(isHomeMode('custom'), true);
    assert.equal(isHomeMode('other'), false);
    assert.equal(isHomeMode(null), false);
    assert.equal(isHomeMode(42), false);
  });
});

describe('section provider registry', () => {
  const providers = buildSectionProviders();

  it('registers the expected section keys', () => {
    for (const key of [
      'tmdb-trending-hero',
      'tmdb-trending-movies',
      'tmdb-popular-movies',
      'tmdb-popular-tv',
      'tmdb-top-rated-movies',
      'tmdb-top-rated-tv',
      'tmdb-new-releases',
      'tmdb-region-top',
      'tmdb-genre-rails',
      'collections',
      'trakt-lists',
    ]) {
      assert.ok(providers.has(key), `missing provider ${key}`);
    }
  });

  it('uses unique keys', () => {
    const keys = [...providers.values()].map((p) => p.key);
    assert.equal(new Set(keys).size, keys.length);
  });

  it('every provider exposes a build function', () => {
    for (const provider of providers.values()) {
      assert.equal(typeof provider.build, 'function');
    }
  });
});

describe('HomeModeService.assertCanWrite', () => {
  class FakeHomeModeService extends HomeModeService {
    constructor(private readonly fixedMode: HomeMode) {
      super();
    }
    override async getMode(): Promise<HomeMode> {
      return this.fixedMode;
    }
  }

  it('blocks manual writes unless mode is custom', async () => {
    const service = new FakeHomeModeService('recommended');
    await assert.rejects(
      () => service.assertCanWrite('account', 'profile', 'user'),
      (error: { statusCode?: number; code?: string }) => {
        assert.equal(error.statusCode, 409);
        assert.equal(error.code, 'home_mode_conflict');
        return true;
      },
    );
  });

  it('allows manual writes in custom mode', async () => {
    const service = new FakeHomeModeService('custom');
    await assert.doesNotReject(() => service.assertCanWrite('account', 'profile', 'user'));
  });

  it('blocks reco writes in custom mode', async () => {
    const service = new FakeHomeModeService('custom');
    await assert.rejects(
      () => service.assertCanWrite('account', 'profile', 'service'),
      (error: { statusCode?: number; code?: string }) => {
        assert.equal(error.statusCode, 409);
        assert.equal(error.code, 'home_mode_conflict');
        return true;
      },
    );
  });

  it('allows reco writes in recommended mode', async () => {
    const service = new FakeHomeModeService('recommended');
    await assert.doesNotReject(() => service.assertCanWrite('account', 'profile', 'service'));
  });
});
