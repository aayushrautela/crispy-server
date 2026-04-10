import { Redis } from 'ioredis';
import { env } from '../config/env.js';

type RedisLike = Pick<Redis, 'get' | 'set' | 'del' | 'sadd' | 'smembers' | 'eval' | 'scan' | 'disconnect' | 'on'>;

const isTestEnv = process.env.NODE_ENV?.trim() === 'test'
  || process.execArgv.includes('--test')
  || process.argv.includes('--test')
  || process.env.npm_lifecycle_event === 'test'
  || process.env.npm_command === 'test';

class TestRedis implements RedisLike {
  private readonly kv = new Map<string, string>();
  private readonly sets = new Map<string, Set<string>>();

  async get(key: string): Promise<string | null> {
    return this.kv.get(key) ?? null;
  }

  async set(key: string, value: string, ..._args: unknown[]): Promise<'OK'> {
    this.kv.set(key, value);
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    let deleted = 0;
    for (const key of keys) {
      if (this.kv.delete(key)) {
        deleted += 1;
      }
      if (this.sets.delete(key)) {
        deleted += 1;
      }
    }
    return deleted;
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    const set = this.sets.get(key) ?? new Set<string>();
    let added = 0;
    for (const member of members) {
      if (!set.has(member)) {
        set.add(member);
        added += 1;
      }
    }
    this.sets.set(key, set);
    return added;
  }

  async smembers(key: string): Promise<string[]> {
    return Array.from(this.sets.get(key) ?? []);
  }

  async eval(_script: string, numKeys: number, ...args: string[]): Promise<number | null> {
    const keys = args.slice(0, numKeys);
    const [key] = keys;
    const raw = key ? this.kv.get(key) ?? null : null;
    if (!raw) {
      return null;
    }

    this.kv.delete(key);
    return 1;
  }

  async scan(cursor: number | string, ..._args: unknown[]): Promise<[string, string[]]> {
    const normalized = String(cursor);
    if (normalized !== '0') {
      return ['0', []];
    }

    return ['0', Array.from(this.kv.keys())];
  }

  disconnect(): void {
    this.kv.clear();
    this.sets.clear();
  }

  on(_event: string, _listener: (...args: unknown[]) => void): this {
    return this;
  }
}

export const redis: RedisLike = env.nodeEnv === 'test'
  || isTestEnv
  ? new TestRedis()
  : new Redis(env.redisUrl, {
      maxRetriesPerRequest: null,
      lazyConnect: true,
      enableOfflineQueue: true,
    });
