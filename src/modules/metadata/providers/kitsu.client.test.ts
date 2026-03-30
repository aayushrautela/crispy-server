import test from 'node:test';
import assert from 'node:assert/strict';
import { setTestEnv } from '../../../test-helpers.js';

setTestEnv();

test('KitsuClient searches anime with JSON:API headers', async () => {
  let capturedUrl = '';
  let capturedHeaders: Headers | null = null;

  const fetcher: typeof fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedHeaders = new Headers(init?.headers);
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };

  const { KitsuClient } = await import('./kitsu.client.js');
  const client = new KitsuClient(fetcher);
  const payload = await client.searchAnime('Cowboy Bebop', 7);

  assert.deepEqual(payload, { data: [] });
  assert.match(capturedUrl, /\/anime\?/);
  assert.match(capturedUrl, /filter%5Btext%5D=Cowboy\+Bebop|filter%5Btext%5D=Cowboy%20Bebop/);
  assert.match(capturedUrl, /page%5Blimit%5D=7/);
  assert.ok(capturedHeaders);
  const headers = capturedHeaders as Headers;
  assert.equal(headers.get('accept'), 'application/vnd.api+json');
  assert.equal(headers.get('content-type'), 'application/vnd.api+json');
});

test('KitsuClient fetchAnime includes related resources', async () => {
  let capturedUrl = '';

  const fetcher: typeof fetch = async (input) => {
    capturedUrl = String(input);
    return new Response(JSON.stringify({ data: { id: '1' }, included: [] }), { status: 200 });
  };

  const { KitsuClient } = await import('./kitsu.client.js');
  const client = new KitsuClient(fetcher);
  const payload = await client.fetchAnime(1);

  assert.deepEqual(payload, { data: { id: '1' }, included: [] });
  assert.match(capturedUrl, /\/anime\/1\?/);
  assert.match(capturedUrl, /include=episodes%2Cmappings%2Ccategories/);
});
