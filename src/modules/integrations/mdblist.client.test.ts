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

test('MdbListClient includes title lookup details in non-OK errors', async () => {
  const { MdbListClient } = await import('./mdblist.client.js');

  const client = new MdbListClient(async () => new Response('bad tmdb lookup', {
    status: 400,
    headers: {
      'content-type': 'text/plain',
    },
  }));

  await assert.rejects(
    () => client.fetchMovieByTmdb('test-key', 7131),
    (error: unknown) => {
      assert.equal((error as { statusCode?: number }).statusCode, 400);
      assert.deepEqual((error as { details?: unknown }).details, {
        pathname: '/movie/tmdb/7131',
        mediaType: 'movie',
        lookupProvider: 'tmdb',
        lookupId: 7131,
        response: {
          contentType: 'text/plain',
          bodySnippet: 'bad tmdb lookup',
        },
      });
      return true;
    },
  );
});

test('MdbListClient includes ratings request details in non-OK errors', async () => {
  const { MdbListClient } = await import('./mdblist.client.js');

  const client = new MdbListClient(async () => Response.json({ error: 'invalid provider' }, { status: 400 }));

  await assert.rejects(
    () => client.fetchRatings('test-key', 'show', 'letterboxd', { provider: 'imdb', ids: ['tt1234567'] }),
    (error: unknown) => {
      assert.equal((error as { statusCode?: number }).statusCode, 400);
      assert.deepEqual((error as { details?: unknown }).details, {
        pathname: '/rating/show/letterboxd',
        mediaType: 'show',
        returnRating: 'letterboxd',
        request: {
          provider: 'imdb',
          ids: ['tt1234567'],
        },
        response: {
          contentType: 'application/json',
          bodySnippet: '{"error":"invalid provider"}',
        },
      });
      return true;
    },
  );
});
