import { withDbClient } from '../../lib/db.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { assertPublicItemId } from '../identity/public-item-id.js';
import type { MetadataTitleDetail } from './metadata-detail.types.js';
import { resolveTitleItemIdentity } from './metadata-route-identity.js';
import { MetadataTitleAggregateBuilder } from './metadata-title-aggregate.builder.js';
import { MetadataTitleCacheService } from './metadata-title-cache.service.js';
import { metadataTitlePageCacheKey } from './metadata-title-cache-keys.js';

export class MetadataTitlePageService {
  constructor(
    private readonly contentIdentityService = new ContentIdentityService(),
    private readonly aggregateBuilder = new MetadataTitleAggregateBuilder(),
    private readonly cacheService = new MetadataTitleCacheService(),
  ) {}

  async getTitlePage(itemId: string, language?: string | null): Promise<MetadataTitleDetail> {
    const publicItemId = itemId.trim();
    assertPublicItemId(publicItemId);
    const cacheKey = metadataTitlePageCacheKey(publicItemId, language ?? null);
    return this.cacheService.getOrSet(cacheKey, publicItemId, async () => withDbClient(async (client) => {
      const identity = await resolveTitleItemIdentity(client, this.contentIdentityService, publicItemId);
      return this.aggregateBuilder.buildTitleDetail(client, identity, language ?? null);
    }));
  }
}
