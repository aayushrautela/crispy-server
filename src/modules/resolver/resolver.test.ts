import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ChainError,
  followChain,
  parseResolvableUrl,
  type FetchLike,
} from './chain.js';
import { pickForwardableHeaders, ResolverService } from './resolver.service.js';
import type { ProxyConfig } from './proxy.js';

function responseFor(url: string, status: number, headers: Record<string, string> = {}, body = ''): Response {
  return new Response(body, { status, headers });
}

/** Records every transport used, in order, answering each call from `script`. */
function scriptedFetch(script: Response[]): { fetch: FetchLike; calls: string[] } {
  const calls: string[] = [];
  let index = 0;
  const take = (): Response => {
    const response = script[Math.min(index, script.length - 1)];
    index += 1;
    if (!response) throw new Error('No scripted response for this call.');
    return response;
  };
  const fetch: FetchLike = async (input) => {
    calls.push(String(input));
    return take();
  };
  return { fetch, calls };
}

test('followChain walks redirects hop by hop and records each status', async () => {
  const resolver = 'https://resolver.example/start';
  const cdn = 'https://cdn.example/media.mp4';
  const { fetch, calls } = scriptedFetch([
    responseFor(resolver, 302, { location: cdn }),
    responseFor(cdn, 200, { 'access-control-allow-origin': '*' }),
  ]);

  const result = await followChain(parseResolvableUrl(resolver), {}, 'https://web.example', fetch);

  assert.equal(calls.length, 2);
  assert.equal(result.url, cdn);
  assert.equal(result.hops.length, 2);
  const hop1 = result.hops.at(0);
  const hop2 = result.hops.at(1);
  assert.ok(hop1 && hop2);
  assert.equal(hop1.status, 302);
  assert.equal(hop2.status, 200);
});

test('followChain follows a JSON-encoded indirection and marks the hop', async () => {
  const resolver = 'https://resolver.example/start';
  const cdn = 'https://cdn.example/real.mkv';
  const { fetch } = scriptedFetch([
    responseFor(resolver, 200, { 'content-type': 'application/json' }, JSON.stringify({ url: cdn })),
    responseFor(cdn, 200, {}),
  ]);

  const result = await followChain(parseResolvableUrl(resolver), {}, undefined, fetch);

  assert.equal(result.url, cdn);
  const hop1 = result.hops.at(0);
  assert.ok(hop1);
  assert.equal(hop1.note, 'json-url');
  assert.equal(result.viaJson, undefined);
});

test('followChain throws too-many-redirects past the limit', async () => {
  const resolver = 'https://resolver.example/start';
  const { fetch } = scriptedFetch([responseFor(resolver, 302, { location: resolver })]);

  await assert.rejects(
    () => followChain(parseResolvableUrl(resolver), {}, undefined, fetch),
    (error: unknown) => error instanceof ChainError && error.reason === 'too-many-redirects',
  );
});

test('parseResolvableUrl refuses private hosts and non-http schemes', () => {
  assert.throws(() => parseResolvableUrl('https://127.0.0.1/x'), (e: unknown) => (e as ChainError).reason === 'blocked-host');
  assert.throws(() => parseResolvableUrl('ftp://example.com/x'), (e: unknown) => (e as ChainError).reason === 'bad-scheme');
  assert.ok(parseResolvableUrl('https://cdn.example/media.mp4'));
});

test('walk prefers the direct transport when the chain resolves cleanly', async () => {
  const cdn = 'https://cdn.example/ok.mp4';
  const proxyFetch = scriptedFetch([responseFor(cdn, 200, {})]);
  const service = new ResolverService({
    directFetch: scriptedFetch([responseFor(cdn, 200, {})]).fetch,
    proxy: { fetch: proxyFetch.fetch, label: 'p:1080' } as ProxyConfig,
  });

  const outcome = await service.walk(parseResolvableUrl(cdn));
  assert.equal(outcome.transport, 'direct');
  assert.equal(proxyFetch.calls.length, 0);
  assert.equal(service.transportMode, 'proxy');
});

test('walk retries through the proxy after a direct refusal, and remembers the host', async () => {
  const resolver = 'https://resolver.example/start';
  const cdn = 'https://cdn.example/proxied.mp4';

  const directRefuses = scriptedFetch([
    responseFor(resolver, 403, { 'content-type': 'text/html', server: 'cloudflare' }),
  ]);
  const proxyServes = scriptedFetch([
    responseFor(resolver, 302, { location: cdn }),
    responseFor(cdn, 200, { 'access-control-allow-origin': '*' }),
  ]);

  const service = new ResolverService({
    directFetch: directRefuses.fetch,
    proxy: { fetch: proxyServes.fetch, label: 'p:1080' } as ProxyConfig,
  });

  const first = await service.walk(parseResolvableUrl(resolver));
  assert.equal(first.transport, 'proxy');
  assert.equal(first.result.url, cdn);
  assert.equal(directRefuses.calls.length, 1);

  // Second walk of the same host skips the leg that already failed once:
  // the proxy answers first and direct is untouched.
  const second = await service.walk(parseResolvableUrl(resolver));
  assert.equal(second.transport, 'proxy');
  assert.equal(directRefuses.calls.length, 1);
});

test('walk without a proxy returns the direct refusal result instead of throwing', async () => {
  const resolver = 'https://resolver.example/start';
  const direct = scriptedFetch([responseFor(resolver, 403, { 'content-type': 'text/html' })]);
  const service = new ResolverService({ directFetch: direct.fetch });

  const outcome = await service.walk(parseResolvableUrl(resolver));
  assert.equal(outcome.transport, 'direct');
  assert.equal(outcome.result.response?.status, 403);
  assert.equal(direct.calls.length, 1);
});

test('walk throws the direct error when every transport fails to walk', async () => {
  const resolver = 'https://resolver.example/start';
  const failing: FetchLike = async () => {
    throw new Error('socket hang up');
  };
  const service = new ResolverService({
    directFetch: failing,
    proxy: { fetch: failing, label: 'p:1080' } as ProxyConfig,
  });

  await assert.rejects(
    () => service.walk(parseResolvableUrl(resolver)),
    /socket hang up/,
  );
});

test('pickForwardableHeaders keeps only the allowlisted auth headers', async () => {
  const { pickForwardableHeaders } = await import('./resolver.service.js');
  assert.deepEqual(
    pickForwardableHeaders({
      authorization: 'Bearer t',
      'X-API-Key': 'k',
      cookie: 'nope',
      'x-auth-token': 42,
    }),
    { authorization: 'Bearer t', 'x-api-key': 'k' },
  );
  assert.deepEqual(pickForwardableHeaders('not-an-object'), {});
});
