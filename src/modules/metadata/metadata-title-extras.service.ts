import { withDbClient } from '../../lib/db.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { assertPublicItemId } from '../identity/public-item-id.js';
import type { MetadataTitleExtrasInternal } from './metadata-detail.types.js';
import { resolveSeriesItemIdentity } from './metadata-route-identity.js';
import { MetadataTitleExtrasBuilder } from './metadata-title-extras.builder.js';

export class MetadataTitleExtrasService {
  constructor(
    private readonly contentIdentityService = new ContentIdentityService(),
    private readonly extrasBuilder = new MetadataTitleExtrasBuilder(),
  ) {}

  async getTitleExtrasInternal(itemId: string, language?: string | null): Promise<MetadataTitleExtrasInternal> {
    const publicItemId = itemId.trim();
    assertPublicItemId(publicItemId);
    return withDbClient(async (client) => {
      const identity = await resolveSeriesItemIdentity(client, this.contentIdentityService, publicItemId);
      return this.extrasBuilder.buildTitleExtrasInternal(client, identity, language ?? null);
    });
  }
}
