import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

test('invalidateByMediaKey removes all cached language variants', async (t) => {
  const { MetadataTitleCacheService } = await import('./metadata-title-cache.service.js');
  const { redis } = await import('../../lib/redis.js');
  const { metadataTitlePageCacheIndexKey } = await import('./metadata-title-cache-keys.js');

  const originals = {
    set: redis.set.bind(redis),
    get: redis.get.bind(redis),
    sadd: redis.sadd.bind(redis),
    smembers: redis.smembers.bind(redis),
    del: redis.del.bind(redis),
  };

  const kv = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  const deleted: string[][] = [];

  redis.set = (async (key: string, value: string) => {
    kv.set(key, value);
    return 'OK';
  }) as typeof redis.set;
  redis.get = (async (key: string) => kv.get(key) ?? null) as typeof redis.get;
  redis.sadd = (async (key: string, member: string) => {
    const set = sets.get(key) ?? new Set<string>();
    set.add(member);
    sets.set(key, set);
    return 1;
  }) as typeof redis.sadd;
  redis.smembers = (async (key: string) => Array.from(sets.get(key) ?? [])) as typeof redis.smembers;
  redis.del = (async (...keys: string[]) => {
    deleted.push(keys);
    for (const key of keys) {
      kv.delete(key);
      sets.delete(key);
    }
    return keys.length;
  }) as typeof redis.del;

  t.after(() => {
    redis.set = originals.set;
    redis.get = originals.get;
    redis.sadd = originals.sadd;
    redis.smembers = originals.smembers;
    redis.del = originals.del;
  });

  const service = new MetadataTitleCacheService();
  await service.set('meta:v2:title-page:en:show:tvdb:100', { ok: true }, 'show:tvdb:100');
  await service.set('meta:v2:title-page:fr:show:tvdb:100', { ok: true }, 'show:tvdb:100');

  assert.equal(sets.get(metadataTitlePageCacheIndexKey('show:tvdb:100'))?.size, 2);

  await service.invalidateByMediaKey('show:tvdb:100');

  assert.deepEqual(deleted, [[
    'meta:v2:title-page:en:show:tvdb:100',
    'meta:v2:title-page:fr:show:tvdb:100',
    metadataTitlePageCacheIndexKey('show:tvdb:100'),
  ]]);
  assert.equal(sets.has(metadataTitlePageCacheIndexKey('show:tvdb:100')), false);
});
