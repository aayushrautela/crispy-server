import { AsyncLocalStorage } from 'node:async_hooks';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

interface RequestScope {
  cache: Map<string, CacheEntry<unknown>>;
  inflight: Map<string, Promise<unknown>>;
}

const DEFAULT_TTL_MS = 30_000;

const asyncLocalStorage = new AsyncLocalStorage<RequestScope>();

function createScope(): RequestScope {
  return { cache: new Map(), inflight: new Map() };
}

// Process-wide fallback used when no request scope is active (workers, cron jobs).
// Keeps a short TTL so cross-request de-duplication still works without leaking memory.
const fallbackScope: RequestScope = createScope();

export function runWithRequestScope<T>(fn: () => Promise<T>): Promise<T> {
  return asyncLocalStorage.run(createScope(), fn);
}

function currentScope(): RequestScope {
  return asyncLocalStorage.getStore() ?? fallbackScope;
}

/**
 * Memoize an async computation for the lifetime of the current request (or a short TTL
 * outside of a request). Concurrent callers for the same key share a single in-flight
 * promise, so this both caches and coalesces duplicate work within a request.
 */
export async function requestMemoize<T>(key: string, fn: () => Promise<T>, ttlMs: number = DEFAULT_TTL_MS): Promise<T> {
  const scope = currentScope();
  const now = Date.now();

  const cached = scope.cache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value as T;
  }

  const existing = scope.inflight.get(key);
  if (existing) {
    return existing as Promise<T>;
  }

  const promise = (async () => {
    const value = await fn();
    scope.cache.set(key, { value, expiresAt: now + ttlMs });
    return value;
  })().finally(() => {
    scope.inflight.delete(key);
  });

  scope.inflight.set(key, promise);
  return promise;
}
