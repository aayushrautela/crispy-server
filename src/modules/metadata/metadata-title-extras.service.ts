import { withDbClient } from '../../lib/db.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { assertPublicItemId } from '../identity/public-item-id.js';
import type { MetadataTitleExtras } from './metadata-detail.types.js';
import { resolveTitleItemIdentity } from './metadata-route-identity.js';
import { MetadataTitleExtrasBuilder } from './metadata-title-extras.builder.js';
import { MetadataTitleCacheService } from './metadata-title-cache.service.js';
import { metadataTitleExtrasCacheKey } from './metadata-title-cache-keys.js';

export class MetadataTitleExtrasService {
  constructor(
    private readonly contentIdentityService = new ContentIdentityService(),
    private readonly extrasBuilder = new MetadataTitleExtrasBuilder(),
    private readonly cacheService = new MetadataTitleCacheService(),
  ) {}

  async getTitleExtras(itemId: string, language?: string | null): Promise<MetadataTitleExtras> {
    const publicItemId = itemId.trim();
    const contentId = assertPublicItemId(publicItemId);
    const cacheKey = metadataTitleExtrasCacheKey(publicItemId, language ?? null);
    return this.cacheService.getOrSet(cacheKey, publicItemId, async () => withDbClient(async (client) => {
      const identity = await resolveTitleItemIdentity(client, this.contentIdentityService, contentId);
      return this.extrasBuilder.buildTitleExtras(client, identity, language ?? null);
    }));
  }
}
