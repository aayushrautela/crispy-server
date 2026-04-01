import test from 'node:test';
import assert from 'node:assert/strict';
import { WatchHistoryRepository } from './watch-history.repo.js';
import { WatchlistRepository } from './watchlist.repo.js';
import { RatingsRepository } from './ratings.repo.js';

test('watch history listPage dedupes title cards before pagination', async () => {
  const repo = new WatchHistoryRepository();
  let capturedQuery = '';
  let capturedValues: unknown[] = [];
  const client = {
    query: async (query: string, values: unknown[] = []) => {
      capturedQuery = query;
      capturedValues = values;
      return { rows: [] };
    },
  } as never;

  await repo.listPage(client, 'profile-1', 20, {
    sortValue: '2024-01-01T00:00:00.000Z',
    tieBreaker: 'episode:tvdb:194031:1:2',
  });

  assert.match(capturedQuery, /FROM watch_history_latest source/);
  assert.match(capturedQuery, /INNER JOIN watch_media_card_cache cache/);
  assert.match(capturedQuery, /PARTITION BY cache\.title_media_type, cache\.title_provider, cache\.title_provider_id/);
  assert.match(capturedQuery, /ORDER BY source\.watched_at DESC, source\.media_key DESC/);
  assert.match(capturedQuery, /WHERE title_rank = 1/);
  assert.deepEqual(capturedValues, ['profile-1', '2024-01-01T00:00:00.000Z', 'episode:tvdb:194031:1:2', 21]);
});

test('watchlist listPage dedupes title cards before pagination', async () => {
  const repo = new WatchlistRepository();
  let capturedQuery = '';
  let capturedValues: unknown[] = [];
  const client = {
    query: async (query: string, values: unknown[] = []) => {
      capturedQuery = query;
      capturedValues = values;
      return { rows: [] };
    },
  } as never;

  await repo.listPage(client, 'profile-1', 10, {
    sortValue: '2024-01-02T00:00:00.000Z',
    tieBreaker: 'episode:tvdb:194031:1:3',
  });

  assert.match(capturedQuery, /FROM watchlist_items source/);
  assert.match(capturedQuery, /INNER JOIN watch_media_card_cache cache/);
  assert.match(capturedQuery, /ORDER BY source\.added_at DESC, source\.media_key DESC/);
  assert.match(capturedQuery, /WHERE title_rank = 1/);
  assert.deepEqual(capturedValues, ['profile-1', '2024-01-02T00:00:00.000Z', 'episode:tvdb:194031:1:3', 11]);
});

test('ratings listPage dedupes title cards before pagination', async () => {
  const repo = new RatingsRepository();
  let capturedQuery = '';
  let capturedValues: unknown[] = [];
  const client = {
    query: async (query: string, values: unknown[] = []) => {
      capturedQuery = query;
      capturedValues = values;
      return { rows: [] };
    },
  } as never;

  await repo.listPage(client, 'profile-1', 15, {
    sortValue: '2024-01-03T00:00:00.000Z',
    tieBreaker: 'episode:tvdb:194031:1:4',
  });

  assert.match(capturedQuery, /FROM ratings source/);
  assert.match(capturedQuery, /INNER JOIN watch_media_card_cache cache/);
  assert.match(capturedQuery, /ORDER BY source\.rated_at DESC, source\.media_key DESC/);
  assert.match(capturedQuery, /WHERE title_rank = 1/);
  assert.deepEqual(capturedValues, ['profile-1', '2024-01-03T00:00:00.000Z', 'episode:tvdb:194031:1:4', 16]);
});
