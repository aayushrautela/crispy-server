import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';
import type { FetchLike } from '../../modules/resolver/chain.js';
import { ResolverService } from '../../modules/resolver/resolver.service.js';
import { InMemoryRateLimitStore } from '../../modules/apps/app-rate-limit.service.js';
import { registerResolverRoutes } from './resolver.js';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...headers } });
}

function mediaResponse(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { 'content-type': 'video/mp4', ...headers } });
}

function recordingFetch(script: Response[]): { fetch: FetchLike; calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let index = 0;
  const take = (): Response => {
    const response = script[Math.min(index, script.length - 1)];
    index += 1;
    if (!response) throw new Error('No scripted response for this call.');
    return response;
  };
  const fetch: FetchLike = async (input, init) => {
    calls.push({ url: String(input), init });
    return take();
  };
  return { fetch, calls };
}

async function buildApp(deps: Partial<Parameters<typeof registerResolverRoutes>[1]> = {}): Promise<FastifyInstance> {
  const app = Fastify();
  await registerResolverRoutes(app, deps);
  return app;
}

test('POST /v1/resolve-url reports cors-ok with hops for a redirect chain', async (t) => {
  const direct = recordingFetch([
    jsonResponse(302, null, { location: 'https://cdn.example/final.mp4' }),
    jsonResponse(200, null, { 'access-control-allow-origin': '*' }),
  ]);
  const service = new ResolverService({ directFetch: direct.fetch });
  const app = await buildApp({ resolver: service });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: '/v1/resolve-url',
    payload: { url: 'https://resolver.example/start', origin: 'https://web.example' },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  const body = response.json();
  assert.equal(body.url, 'https://cdn.example/final.mp4');
  assert.equal(body.cors, true);
  assert.equal(body.reason, 'cors-ok');
  assert.equal(body.resolved, true);
  assert.equal(body.hops.length, 2);
});

test('POST /v1/resolve-url refuses a private host with blocked-host and keeps the input URL', async (t) => {
  const service = new ResolverService({ directFetch: recordingFetch([]).fetch });
  const app = await buildApp({ resolver: service });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: '/v1/resolve-url',
    payload: { url: 'https://127.0.0.1/media.mp4' },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.url, 'https://127.0.0.1/media.mp4');
  assert.equal(body.cors, false);
  assert.equal(body.reason, 'blocked-host');
  assert.deepEqual(body.hops, []);
});

test('POST /v1/resolve-url reports the terminal refusal (proxy absent)', async (t) => {
  const direct = recordingFetch([
    jsonResponse(403, 'blocked', { 'content-type': 'text/html', server: 'cloudflare' }),
  ]);
  const service = new ResolverService({ directFetch: direct.fetch });
  const app = await buildApp({ resolver: service });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: '/v1/resolve-url',
    payload: { url: 'https://resolver.example/start' },
  });

  const body = response.json();
  assert.equal(body.reason, 'status-403');
  assert.equal(body.resolved, false);
  assert.equal(body.hops.length, 1);
});

test('GET /v1/resolve-url reads url and headers from the query string', async (t) => {
  const direct = recordingFetch([
    jsonResponse(200, null, { 'access-control-allow-origin': '*' }),
  ]);
  const service = new ResolverService({ directFetch: direct.fetch });
  const app = await buildApp({ resolver: service });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'GET',
    url: '/v1/resolve-url?url=https%3A%2F%2Fcdn.example%2Fok.mp4',
  });

  const body = response.json();
  assert.equal(body.reason, 'no-redirect');
  assert.equal(body.cors, true);
});

test('POST /v1/resolve-url without url answers missing-url', async (t) => {
  const app = await buildApp();
  t.after(() => app.close());

  const response = await app.inject({ method: 'POST', url: '/v1/resolve-url', payload: {} });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().reason, 'missing-url');
});

test('POST /v1/resolve-url rate limits per client IP', async (t) => {
  const service = new ResolverService({
    directFetch: recordingFetch([jsonResponse(200, null, { 'access-control-allow-origin': '*' })]).fetch,
  });
  const app = await buildApp({ resolver: service, rateLimitStore: new InMemoryRateLimitStore() });
  t.after(() => app.close());

  let limited: { statusCode: number; reason?: string } | undefined;
  for (let i = 0; i <= 60; i += 1) {
    const response = await app.inject({ method: 'POST', url: '/v1/resolve-url', payload: { url: 'https://cdn.example/ok.mp4' } });
    if (response.statusCode === 429) limited = { statusCode: response.statusCode, reason: response.json().reason };
  }

  assert.ok(limited, 'expected a 429 once the per-IP window is exceeded');
  assert.equal(limited.reason, 'rate-limited');
});

test('GET /v1/stream replays the range against the resolved URL and streams 206', async (t) => {
  const walk = recordingFetch([
    jsonResponse(302, null, { location: 'https://cdn.example/final.mp4' }),
    jsonResponse(200, null, {}),
  ]);
  const media = recordingFetch([
    mediaResponse(206, 'bytes', {
      'content-range': 'bytes 0-0/100',
      'content-length': '5',
      'etag': '"abc"',
    }),
  ]);
  const service = new ResolverService({ directFetch: walk.fetch });
  const app = await buildApp({ resolver: service, mediaFetch: media.fetch });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'GET',
    url: '/v1/stream?url=https%3A%2F%2Fresolver.example%2Fstart',
    headers: { range: 'bytes=0-0' },
  });

  assert.equal(response.statusCode, 206);
  assert.equal(response.headers['content-range'], 'bytes 0-0/100');
  assert.equal(response.headers['x-crispy-reason'], 'proxied');
  assert.equal(response.headers['x-crispy-hops'], '2');
  assert.equal(response.headers['x-crispy-source'], 'cdn.example');
  assert.equal(response.headers['accept-ranges'], 'bytes');
  assert.equal(response.payload, 'bytes');

  // The replay asked the final URL directly, forwarding the client's Range.
  assert.equal(media.calls.length, 1);
  const replayed = media.calls.at(0);
  assert.ok(replayed);
  assert.equal(replayed.url, 'https://cdn.example/final.mp4');
  const replayedHeaders = replayed.init?.headers as Record<string, string>;
  assert.equal(replayedHeaders.range, 'bytes=0-0');
});

test('HEAD /v1/stream returns headers without a body', async (t) => {
  const walk = recordingFetch([jsonResponse(200, null, {})]);
  const media = recordingFetch([mediaResponse(200, 'ignored', {})]);
  const service = new ResolverService({ directFetch: walk.fetch });
  const app = await buildApp({ resolver: service, mediaFetch: media.fetch });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'HEAD',
    url: '/v1/stream?url=https%3A%2F%2Fcdn.example%2Fok.mp4',
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['x-crispy-reason'], 'proxied');
  assert.equal(response.payload, '');
  const replay = media.calls.at(0);
  assert.ok(replay);
  assert.equal(replay.init?.method, 'HEAD');
});

test('GET /v1/stream answers 502 with a reason when the walk throws', async (t) => {
  const failing: FetchLike = async () => {
    throw new Error('ECONNREFUSED');
  };
  const service = new ResolverService({ directFetch: failing });
  const app = await buildApp({ resolver: service });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'GET',
    url: '/v1/stream?url=https%3A%2F%2Fresolver.example%2Fstart',
  });

  assert.equal(response.statusCode, 502);
  const body = response.json();
  assert.equal(body.reason, 'unreachable');
  assert.equal(response.headers['x-crispy-reason'], 'unreachable');
});

test('GET /v1/stream answers 502 when the upstream refuses the replay', async (t) => {
  const walk = recordingFetch([jsonResponse(200, null, {})]);
  const media = recordingFetch([mediaResponse(500, 'oops', {})]);
  const service = new ResolverService({ directFetch: walk.fetch });
  const app = await buildApp({ resolver: service, mediaFetch: media.fetch });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'GET',
    url: '/v1/stream?url=https%3A%2F%2Fcdn.example%2Fok.mp4',
  });

  assert.equal(response.statusCode, 502);
  assert.equal(response.json().reason, 'status-500');
});

test('GET /v1/stream without url answers missing-url', async (t) => {
  const app = await buildApp();
  t.after(() => app.close());

  const response = await app.inject({ method: 'GET', url: '/v1/stream' });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().reason, 'missing-url');
});

test('GET /v1/stream forwards only allowlisted query headers', async (t) => {
  const walk = recordingFetch([jsonResponse(200, null, {})]);
  const media = recordingFetch([mediaResponse(200, 'b', {})]);
  const service = new ResolverService({ directFetch: walk.fetch });
  const app = await buildApp({ resolver: service, mediaFetch: media.fetch });
  t.after(() => app.close());

  const headers = JSON.stringify({ authorization: 'Bearer secret', cookie: 'drop-me' });
  await app.inject({
    method: 'GET',
    url: `/v1/stream?url=https%3A%2F%2Fcdn.example%2Fok.mp4&headers=${encodeURIComponent(headers)}`,
  });

  const walkCall = walk.calls.at(0);
  assert.ok(walkCall);
  const requestHeaders = walkCall.init?.headers as Record<string, string>;
  assert.equal(requestHeaders.authorization, 'Bearer secret');
  assert.equal(requestHeaders.cookie, undefined);
});
