import { withDbClient } from '../../lib/db.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import type { MetadataTitleDetail } from './metadata-detail.types.js';
import { resolveTitleRouteIdentity } from './metadata-route-identity.js';
import { MetadataTitleAggregateBuilder } from './metadata-title-aggregate.builder.js';
import { MetadataTitleCacheService } from './metadata-title-cache.service.js';
import { metadataTitlePageCacheKey } from './metadata-title-cache-keys.js';

export class MetadataTitlePageService {
  constructor(
    private readonly contentIdentityService = new ContentIdentityService(),
    private readonly aggregateBuilder = new MetadataTitleAggregateBuilder(),
    private readonly cacheService = new MetadataTitleCacheService(),
  ) {}

  async getTitlePage(mediaKey: string, language?: string | null): Promise<MetadataTitleDetail> {
    const cacheKey = metadataTitlePageCacheKey(mediaKey, language ?? null);
    return this.cacheService.getOrSet(cacheKey, async () => withDbClient(async (client) => {
      const identity = await resolveTitleRouteIdentity(client, this.contentIdentityService, mediaKey);
      return this.aggregateBuilder.buildTitleDetail(client, identity, language ?? null);
    }));
  }
}
