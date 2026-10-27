import test from 'node:test';
import assert from 'node:assert/strict';

import { setTestEnv } from '../test-helpers.js';

setTestEnv();

test('RedisRateLimitStore accumulates counts within a window', async (t) => {
  const { redis } = await import('./redis.js');
  const { RedisRateLimitStore } = await import('./rate-limit.store.js');

  const store = new RedisRateLimitStore(redis);
  const now = new Date('2024-01-01T00:00:00.000Z');
  const key = 'test:rl:accumulate';

  try {
    const first = await store.increment({ key, windowSeconds: 60, cost: 1, now });
    assert.equal(first.count, 1);
    assert.equal(first.resetAt.toISOString(), '2024-01-01T00:01:00.000Z');

    const second = await store.increment({ key, windowSeconds: 60, cost: 1, now });
    assert.equal(second.count, 2);
  } finally {
    await redis.del(key);
  }
});

test('RedisRateLimitStore honours cost > 1', async (t) => {
  const { redis } = await import('./redis.js');
  const { RedisRateLimitStore } = await import('./rate-limit.store.js');

  const store = new RedisRateLimitStore(redis);
  const now = new Date('2024-01-01T00:00:00.000Z');
  const key = 'test:rl:cost';

  try {
    const result = await store.increment({ key, windowSeconds: 60, cost: 5, now });
    assert.equal(result.count, 5);
  } finally {
    await redis.del(key);
  }
});

test('RedisRateLimitStore keeps separate keys independent', async (t) => {
  const { redis } = await import('./redis.js');
  const { RedisRateLimitStore } = await import('./rate-limit.store.js');

  const store = new RedisRateLimitStore(redis);
  const now = new Date('2024-01-01T00:00:00.000Z');
  const keyA = 'test:rl:a';
  const keyB = 'test:rl:b';

  try {
    await store.increment({ key: keyA, windowSeconds: 60, cost: 1, now });
    const b = await store.increment({ key: keyB, windowSeconds: 60, cost: 1, now });
    assert.equal(b.count, 1);
  } finally {
    await redis.del(keyA, keyB);
  }
});
