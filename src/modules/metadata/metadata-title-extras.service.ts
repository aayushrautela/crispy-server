import { withDbClient } from '../../lib/db.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { assertPublicItemId } from '../identity/public-item-id.js';
import type { MetadataTitleExtras } from './metadata-detail.types.js';
import { resolveSeriesItemIdentity } from './metadata-route-identity.js';
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
    assertPublicItemId(publicItemId);
    const cacheKey = metadataTitleExtrasCacheKey(publicItemId, language ?? null);
    return this.cacheService.getOrSet(cacheKey, publicItemId, async () => withDbClient(async (client) => {
      const identity = await resolveSeriesItemIdentity(client, this.contentIdentityService, publicItemId);
      return this.extrasBuilder.buildTitleExtras(client, identity, language ?? null);
    }));
  }

  async getTitleExtrasInternal(itemId: string, language?: string | null): Promise<{
    seasons: import('../recommendations/client-home.types.js').ClientMediaCard[];
    similar: import('../identity/media-key.js').MediaIdentity[];
    collection: import('../identity/media-key.js').MediaIdentity[] | null;
    reviews: import('./metadata-detail.types.js').MetadataReviewView[];
    resolvedTitle: import('./providers/tmdb.types.js').TmdbTitleRecord;
    effectiveLanguage: string | null;
  }> {
    const publicItemId = itemId.trim();
    assertPublicItemId(publicItemId);
    return withDbClient(async (client) => {
      const identity = await resolveSeriesItemIdentity(client, this.contentIdentityService, publicItemId);
      return this.extrasBuilder.buildTitleExtrasInternal(client, identity, language ?? null);
    });
  }
}
