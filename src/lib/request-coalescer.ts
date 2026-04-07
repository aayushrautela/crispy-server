type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

export class ShortLivedRequestCoalescer<T> {
  private readonly inflight = new Map<string, Promise<T>>();
  private readonly cache = new Map<string, CacheEntry<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async run(key: string, work: () => Promise<T>): Promise<T> {
    const now = this.now();
    this.pruneExpired(now);

    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    const inflight = this.inflight.get(key);
    if (inflight) {
      return inflight;
    }

    const promise = work()
      .then((value) => {
        this.cache.set(key, {
          value,
          expiresAt: this.now() + this.ttlMs,
        });
        return value;
      })
      .finally(() => {
        this.inflight.delete(key);
      });

    this.inflight.set(key, promise);
    return promise;
  }

  clear(): void {
    this.inflight.clear();
    this.cache.clear();
  }

  private pruneExpired(now: number): void {
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt <= now) {
        this.cache.delete(key);
      }
    }
  }
}
