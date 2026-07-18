import { withDbClient } from '../../../lib/db.js';
import { CollectionsRepository } from '../repos/collections.repo.js';
import { DefaultHomeCacheService } from '../default-home.cache.service.js';
import type { CollectionRecord, CollectionSource, ProviderRef } from '../homescreen.types.js';

/**
 * Curated collections registry. Reads/writes come from the homescreen.collections
 * table. Any mutation invalidates the default-home cache so the next request
 * rebuilds with the updated collection rails.
 */
export class CollectionRegistry {
  constructor(
    private readonly repository = new CollectionsRepository(),
    private readonly cache = new DefaultHomeCacheService(),
  ) {}

  async list(source?: CollectionSource): Promise<CollectionRecord[]> {
    return withDbClient((client) => this.repository.list(client, source));
  }

  async get(key: string): Promise<CollectionRecord | null> {
    return withDbClient((client) => this.repository.get(client, key));
  }

  async upsert(params: {
    key: string;
    title: string;
    subtitle?: string | null;
    providerRefs: ProviderRef[];
    source: CollectionSource;
    sourceRef?: string | null;
    updatedBy: string;
  }): Promise<CollectionRecord> {
    const record = await withDbClient((client) =>
      this.repository.upsert(client, {
        ...params,
        lastSyncedAt: params.source === 'trakt' ? new Date() : null,
      }),
    );
    await this.cache.invalidateAll();
    return record;
  }

  async remove(key: string): Promise<void> {
    await withDbClient((client) => this.repository.delete(client, key));
    await this.cache.invalidateAll();
  }
}
