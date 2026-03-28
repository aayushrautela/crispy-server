import test from 'node:test';
import assert from 'node:assert/strict';
import { setTestEnv } from '../../test-helpers.js';

setTestEnv();

test('TvdbClient logs in and searches series with bearer auth', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });

    if (url.endsWith('/login')) {
      return new Response(JSON.stringify({ data: { token: 'tvdb-token' } }), { status: 200 });
    }

    if (url.includes('/search?')) {
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  const { TvdbClient } = await import('./tvdb.client.js');
  const client = new TvdbClient(fetcher);
  const payload = await client.searchSeries('Dexter', 5, 10);

  assert.deepEqual(payload, { data: [] });
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.url, 'https://api4.thetvdb.com/v4/login');
  assert.match(calls[1]?.url ?? '', /\/search\?/);
  assert.match(calls[1]?.url ?? '', /query=Dexter/);
  assert.match(calls[1]?.url ?? '', /type=series/);
  assert.match(calls[1]?.url ?? '', /limit=5/);
  assert.match(calls[1]?.url ?? '', /offset=10/);
  assert.equal(new Headers(calls[1]?.init?.headers).get('authorization'), 'Bearer tvdb-token');
});

test('TvdbClient refreshes token after unauthorized response', async () => {
  let loginCount = 0;
  let seriesCount = 0;

  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/login')) {
      loginCount += 1;
      return new Response(JSON.stringify({ data: { token: `token-${loginCount}` } }), { status: 200 });
    }

    if (url.includes('/series/42/extended')) {
      seriesCount += 1;
      const auth = new Headers(init?.headers).get('authorization');
      if (seriesCount === 1) {
        assert.equal(auth, 'Bearer token-1');
        return new Response(JSON.stringify({ message: 'expired' }), { status: 401 });
      }

      assert.equal(auth, 'Bearer token-2');
      return new Response(JSON.stringify({ data: { id: 42 } }), { status: 200 });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  const { TvdbClient } = await import('./tvdb.client.js');
  const client = new TvdbClient(fetcher);
  const payload = await client.fetchSeriesExtended(42);

  assert.deepEqual(payload, { data: { id: 42 } });
  assert.equal(loginCount, 2);
  assert.equal(seriesCount, 2);
});
