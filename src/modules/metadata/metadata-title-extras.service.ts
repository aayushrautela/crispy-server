import { withDbClient } from '../../lib/db.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import type { MetadataTitleExtras } from './metadata-detail.types.js';
import { resolveTitleRouteIdentity } from './metadata-route-identity.js';
import { MetadataTitleExtrasBuilder } from './metadata-title-extras.builder.js';
import { MetadataTitleCacheService } from './metadata-title-cache.service.js';
import { metadataTitleExtrasCacheKey } from './metadata-title-cache-keys.js';

export class MetadataTitleExtrasService {
  constructor(
    private readonly contentIdentityService = new ContentIdentityService(),
    private readonly extrasBuilder = new MetadataTitleExtrasBuilder(),
    private readonly cacheService = new MetadataTitleCacheService(),
  ) {}

  async getTitleExtras(mediaKey: string, language?: string | null): Promise<MetadataTitleExtras> {
    const cacheKey = metadataTitleExtrasCacheKey(mediaKey, language ?? null);
    return this.cacheService.getOrSet(cacheKey, mediaKey, async () => withDbClient(async (client) => {
      const identity = await resolveTitleRouteIdentity(client, this.contentIdentityService, mediaKey);
      return this.extrasBuilder.buildTitleExtras(client, identity, language ?? null);
    }));
  }
}
