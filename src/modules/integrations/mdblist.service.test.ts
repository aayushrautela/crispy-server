import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

const RATINGS_KEY = 'mdblist:ratings:movie:tmdb:299536';

test('getTitleRatings never caches when every source fails', async () => {
  const { MdbListService } = await import('./mdblist.service.js');
  const { MdbListClient } = await import('./mdblist.client.js');
  const { redis } = await import('../../lib/redis.js');

  const client = new MdbListClient(async () => {
    throw new Error('The operation was aborted due to timeout');
  });
  const service = new MdbListService(client);

  const result = await service.getTitleRatings('test-key', 'movie', { provider: 'tmdb', id: 299536 });
  assert.equal(result, null);
  assert.equal(await redis.get(RATINGS_KEY), null);
});

test('getTitleRatings caches partial results with a short TTL, not the weekly one', async () => {
  const { MdbListService } = await import('./mdblist.service.js');
  const { MdbListClient } = await import('./mdblist.client.js');
  const { redis } = await import('../../lib/redis.js');

  const okBody = {
    provider_id: 'tmdb',
    provider_rating: 'imdb',
    mediatype: 'movie',
    ratings: [{ id: 299536, rating: 8.4 }],
  };
  const client = new MdbListClient(async (input) => {
    // Fail exactly one source (imdb); the other eight succeed.
    if (String(input).includes('/rating/movie/imdb')) {
      return new Response('<html>500</html>', { status: 500, headers: { 'content-type': 'text/html' } });
    }
    return Response.json({ ...okBody, provider_rating: 'imdb' });
  });
  const service = new MdbListService(client);

  const result = await service.getTitleRatings('test-key', 'movie', { provider: 'tmdb', id: 299536 });
  assert.notEqual(result, null);
  assert.equal(result!.ratings.imdb, null);
  assert.equal(result!.ratings.tmdb, 8.4);

  // Inspect the TTL the partial result was cached with.
  const setCalls: Array<{ key: string; ttl: number }> = [];
  const originalSet = redis.set.bind(redis);
  (redis as unknown as { set: typeof redis.set }).set = async (key: string, value: string, ...args: unknown[]) => {
    setCalls.push({ key, ttl: Number(args[1] ?? 0) });
    return originalSet(key, value, ...(args as Parameters<typeof originalSet>));
  };
  try {
    await redis.del(RATINGS_KEY);
    await service.getTitleRatings('test-key', 'movie', { provider: 'tmdb', id: 299536 });
    const last = setCalls.at(-1);
    assert.notEqual(last, undefined);
    assert.equal(last!.key, RATINGS_KEY);
    assert.ok(last!.ttl <= 600, `expected short partial TTL, got ${last!.ttl}`);
  } finally {
    (redis as unknown as { set: typeof redis.set }).set = originalSet;
  }
});
