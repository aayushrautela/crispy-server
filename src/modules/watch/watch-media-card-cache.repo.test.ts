import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';
import { WatchMediaCardCacheRepository } from './watch-media-card-cache.repo.js';

seedTestEnv();

const ITEM_ID_1 = '00000000000000000000000000000001';
const ITEM_ID_2 = '00000000000000000000000000000002';
const UUID_1 = '00000000-0000-0000-0000-000000000001';
const UUID_2 = '00000000-0000-0000-0000-000000000002';

test('getByItemIds reads requested language and falls back to en-US for misses', async () => {
  const repository = new WatchMediaCardCacheRepository();
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    query: async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      if (calls.length === 1) {
        assert.deepEqual(params, [[UUID_1, UUID_2], 'fr-FR']);
        return {
          rows: [row({ item_id: UUID_1, title: 'Localized', language: 'fr-FR' })],
        };
      }

      assert.deepEqual(params, [[UUID_2], 'en-US']);
      return {
        rows: [row({ item_id: UUID_2, title: 'Fallback', language: 'en-US' })],
      };
    },
  };

  const records = await repository.getByItemIds(client as never, [ITEM_ID_1, ITEM_ID_2], 'fr-FR');

  assert.equal(calls.length, 2);
  assert.doesNotMatch(calls[0]?.sql ?? '', /DISTINCT ON/);
  assert.equal(records.get(ITEM_ID_1)?.title, 'Localized');
  assert.equal(records.get(ITEM_ID_1)?.language, 'fr-FR');
  assert.equal(records.get(ITEM_ID_2)?.title, 'Fallback');
  assert.equal(records.get(ITEM_ID_2)?.language, 'en-US');
});

function row(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    item_id: UUID_1,
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
