import test from 'node:test';
import assert from 'node:assert/strict';
import { setTestEnv } from '../../../test-helpers.js';

setTestEnv({ TRAKT_IMPORT_CLIENT_ID: 'trakt-test-id' });

test('TraktClient fetches movie reviews with trakt headers', async () => {
  let capturedUrl = '';
  let capturedHeaders: Headers | null = null;

  const fetcher: typeof fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedHeaders = new Headers(init?.headers);
    return new Response(JSON.stringify([
      {
        comment: {
          id: 267,
          comment: 'Great kickoff to a new Batman trilogy!',
          review: true,
          created_at: '2015-04-25T00:14:57.000Z',
          updated_at: '2015-04-25T00:14:57.000Z',
          user: { name: 'Justin N.', username: 'justin', ids: { slug: 'justin' } },
          user_stats: { rating: 10 },
        },
      },
    ]), { status: 200 });
  };

  const { TraktClient } = await import('./trakt.client.js');
  const client = new TraktClient(fetcher);
  const reviews = await client.fetchTitleReviews('movie', { imdb: 'tt0372784', tmdb: null, tvdb: null }, 5);

  assert.equal(reviews.length, 1);
  assert.equal(reviews[0]?.id, 'trakt:267');
  assert.equal(reviews[0]?.author, 'Justin N.');
  assert.equal(reviews[0]?.rating, 10);
  assert.equal(reviews[0]?.url, 'https://trakt.tv/comments/267');
  assert.match(capturedUrl, /\/movies\/tt0372784\/comments\?/);
  assert.match(capturedUrl, /limit=5/);
  assert.ok(capturedHeaders);
  const headers = capturedHeaders as Headers;
  assert.equal(headers.get('accept'), 'application/json');
  assert.equal(headers.get('trakt-api-key'), 'trakt-test-id');
  assert.equal(headers.get('trakt-api-version'), '2');
});

test('TraktClient resolves TMDB ids through search before loading show reviews', async () => {
  const calls: string[] = [];

  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);

    if (url.includes('/search/tmdb/1396')) {
      return new Response(JSON.stringify([
        { show: { ids: { trakt: 1, slug: 'breaking-bad' } } },
      ]), { status: 200 });
    }

    if (url.includes('/shows/1/comments')) {
      return new Response(JSON.stringify([
        {
          comment: {
            id: 199,
            comment: 'Skyler, I AM THE DANGER.',
            review: false,
            created_at: '2015-02-18T06:02:30.000Z',
            updated_at: '2015-02-18T06:02:30.000Z',
            user: { name: 'Justin N.', username: 'justin' },
            user_stats: { rating: 10 },
          },
        },
      ]), { status: 200 });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  const { TraktClient } = await import('./trakt.client.js');
  const client = new TraktClient(fetcher);
  const reviews = await client.fetchTitleReviews('show', { imdb: null, tmdb: 1396, tvdb: null });

  assert.equal(reviews.length, 1);
  assert.equal(reviews[0]?.id, 'trakt:199');
  assert.match(calls[0] ?? '', /\/search\/tmdb\/1396\?/);
  assert.match(calls[0] ?? '', /type=show/);
  assert.match(calls[1] ?? '', /\/shows\/1\/comments\?/);
});
