import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';
import { WatchMediaCardCacheRepository } from './watch-media-card-cache.repo.js';

seedTestEnv();

test('getByMediaKeys prefers requested language and falls back to English', async () => {
  const repository = new WatchMediaCardCacheRepository();
  const client = {
    query: async (sql: string, params: unknown[]) => {
      assert.match(sql, /DISTINCT ON \(media_key\)/);
      assert.deepEqual(params, [['movie:tmdb:1', 'movie:tmdb:2'], ['en-US', 'en'], 'en-US']);
      return {
        rows: [
          row({ media_key: 'movie:tmdb:1', title: 'Localized', language: 'en-US' }),
          row({ media_key: 'movie:tmdb:2', title: 'Fallback', language: 'en' }),
        ],
      };
    },
  };

  const records = await repository.getByMediaKeys(client as never, ['movie:tmdb:1', 'movie:tmdb:2'], 'en-US');

  assert.equal(records.get('movie:tmdb:1')?.title, 'Localized');
  assert.equal(records.get('movie:tmdb:1')?.language, 'en-US');
  assert.equal(records.get('movie:tmdb:2')?.title, 'Fallback');
  assert.equal(records.get('movie:tmdb:2')?.language, 'en');
});

function row(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    media_key: 'movie:tmdb:1',
    media_type: 'movie',
    title_provider: 'tmdb',
    title_provider_id: '1',
    title_media_type: 'movie',
    title: 'Movie',
    subtitle: null,
    poster_url: 'https://cache.test/poster.jpg',
    backdrop_url: null,
    logo_url: null,
    trailer_url: null,
    trailer_thumbnail_url: null,
    poster_color: null,
    backdrop_color: null,
    release_year: 2024,
    rating: 8.5,
    maturity_rating: null,
    genres: ['Drama'],
    language: 'en',
    ...overrides,
  };
}
