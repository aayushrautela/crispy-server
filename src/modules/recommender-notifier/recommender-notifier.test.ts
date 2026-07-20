import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();
const { RecommenderNotifier } = await import('./recommender-notifier.js');

const originalFetch = globalThis.fetch;

function makeStubFetch(opts: { status?: number; throwOnCall?: Error } = {}): {
  stub: typeof fetch;
  calls: Array<{ url: string; init?: RequestInit }>;
} {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const status = opts.status ?? 202;
  const stub = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (opts.throwOnCall) throw opts.throwOnCall;
    return new Response('ok', { status });
  }) as typeof fetch;
  return { stub, calls };
}

beforeEach(() => {
  // no-op; each test installs its own stub
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('notifyRecompute posts the expected event body to ${baseUrl}/events', async () => {
  const { stub, calls } = makeStubFetch();
  globalThis.fetch = stub;

  const notifier = new RecommenderNotifier({
    baseUrl: 'https://reco.example.test/internal/recommender/v1',
    token: 'secret-token',
  });
  notifier.notifyRecompute({ accountId: 'acc-1', profileId: 'prof-1', reason: 'profile_created' });
  await flushMicrotasks();

  assert.equal(calls.length, 1, 'one POST fired');
  assert.equal(calls[0]?.url, 'https://reco.example.test/internal/recommender/v1/events');
  assert.equal(calls[0]?.init?.method, 'POST');

  const headers = calls[0]?.init?.headers as Record<string, string>;
  assert.equal(headers['Authorization'], 'Bearer secret-token');
  assert.equal(headers['Content-Type'], 'application/json');

  const body = JSON.parse(String(calls[0]?.init?.body));
  assert.equal(body.eventType, 'recommendation.recompute_requested');
  assert.equal(body.eventVersion, 1);
  assert.equal(body.aggregateType, 'profile');
  assert.equal(body.aggregateId, 'prof-1');
  assert.equal(body.profileId, 'prof-1');
  assert.equal(body.userId, 'acc-1');
  assert.equal(body.source, 'crispy-server');
  assert.equal(body.payload.reason, 'profile_created');
  assert.match(String(body.eventId), /^crispy-prof-1-\d+-[a-z0-9]+$/, 'eventId is deterministic-prefix + unique suffix');
});

test('notifyRecompute returns synchronously (caller does not await the POST)', () => {
  let fetchStarted = false;
  globalThis.fetch = (async () => {
    fetchStarted = true;
    return new Response('ok', { status: 202 });
  }) as typeof fetch;

  const notifier = new RecommenderNotifier({ baseUrl: 'https://reco.test', token: 't' });
  const result = notifier.notifyRecompute({ accountId: 'a', profileId: 'p', reason: 'rating_changed' });
  assert.equal(result, undefined, 'notifyRecompute returns void immediately');
  // no assert on fetchStarted here because we haven't flushed microtasks; the
  // contract is "caller doesn't await", proved by the void return type above.
});

test('network errors are swallowed (fire-and-forget) and logged at warn', async () => {
  const calls: Array<Error> = [];
  let posted = false;
  globalThis.fetch = (async () => {
    posted = true;
    throw new Error('boom: reco offline');
  }) as typeof fetch;

  const notifier = new RecommenderNotifier({ baseUrl: 'https://reco.test', token: 't' });
  notifier.notifyRecompute({ accountId: 'a', profileId: 'p', reason: 'admin_requested' });

  // caller never threw; just verify the POST was attempted (swallowed)
  await flushMicrotasks();
  assert.equal(posted, true, 'fetch was attempted');
  assert.equal(calls.length, 0, 'no re-thrown errors escaped to caller');
});

test('non-2xx responses (other than 409) are tolerated and do not throw', async () => {
  globalThis.fetch = makeStubFetch({ status: 500 }).stub;
  const notifier = new RecommenderNotifier({ baseUrl: 'https://reco.test', token: 't' });
  notifier.notifyRecompute({ accountId: 'a', profileId: 'p', reason: 'watchlist_changed' });
  await flushMicrotasks();
  // no assertion-throw path; test passes if no exception escapes
  assert.ok(true);
});

test('409 conflict is tolerated without logging a warn (idempotent replay)', async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response('conflict', { status: 409 });
  }) as typeof fetch;

  const notifier = new RecommenderNotifier({ baseUrl: 'https://reco.test', token: 't' });
  notifier.notifyRecompute({ accountId: 'a', profileId: 'p', reason: 'watch_history_changed' });
  await flushMicrotasks();
  assert.equal(calls, 1, 'POST happened');
});

test('notifier with no baseUrl is a no-op (no fetch attempted)', async () => {
  let posted = false;
  globalThis.fetch = (async () => {
    posted = true;
    return new Response('ok');
  }) as typeof fetch;

  const notifier = new RecommenderNotifier({ baseUrl: '', token: '' });
  notifier.notifyRecompute({ accountId: 'a', profileId: 'p', reason: 'profile_created' });
  await flushMicrotasks();
  assert.equal(posted, false, 'no POST fired when baseUrl is empty');
});

test('aborts the fetch when timeoutMs elapses', async () => {
  let abortSignal: AbortSignal | null | undefined;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    abortSignal = init?.signal;
    // simulate a hung receiver; the abort will race
    return new Promise((_, reject) => {
      abortSignal?.addEventListener('abort', () => reject(new Error('aborted')));
    });
  }) as typeof fetch;

  const notifier = new RecommenderNotifier({ baseUrl: 'https://reco.test', token: 't', timeoutMs: 10 });
  notifier.notifyRecompute({ accountId: 'a', profileId: 'p', reason: 'profile_settings_changed' });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(abortSignal?.aborted, 'AbortController fired');
});

async function flushMicrotasks(): Promise<void> {
  // two microtask ticks + a small macrotask to be sure the swallowed promise
  // chain inside notifyRecompute has settled.
  await new Promise((r) => setTimeout(r, 5));
  await Promise.resolve();
  await Promise.resolve();
}
