import test from 'node:test';
import assert from 'node:assert/strict';

test('MdbListClient posts documented ratings request shape', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const { MdbListClient } = await import('./mdblist.client.js');

  const client = new MdbListClient(async (input, init) => {
    calls.push({ url: String(input), init });
    return Response.json({
      provider_id: 'tmdb',
      provider_rating: 'letterboxd',
      mediatype: 'movie',
      ratings: [{ id: 923, rating: 4.1 }],
    });
  });

  const result = await client.fetchRatings('test-key', 'movie', 'letterboxd', {
    provider: 'tmdb',
    ids: [923],
  });

  assert.equal(result.provider_rating, 'letterboxd');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, 'https://api.mdblist.com/rating/movie/letterboxd?apikey=test-key');
  assert.equal(calls[0]?.init?.method, 'POST');
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
    provider: 'tmdb',
    ids: [923],
  });
});
