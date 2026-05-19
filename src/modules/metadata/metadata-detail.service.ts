import { withDbClient } from '../../lib/db.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { assertPublicItemId } from '../identity/public-item-id.js';
import { MetadataDetailCoreService } from './metadata-detail-core.service.js';
import { MetadataTitlePageService } from './metadata-title-page.service.js';
import type { MetadataResolveResponse, MetadataTitleDetail } from './metadata-detail.types.js';

type ResolveInput = {
  itemId: string;
  language?: string | null;
};

export class MetadataDetailService {
  constructor(
    private readonly metadataDetailCoreService = new MetadataDetailCoreService(),
    private readonly metadataTitlePageService = new MetadataTitlePageService(),
    private readonly contentIdentityService = new ContentIdentityService(),
  ) {}

  async resolve(input: ResolveInput): Promise<MetadataResolveResponse> {
    const itemId = assertPublicItemId(input.itemId);
    return withDbClient(async (client) => {
      const identity = await this.contentIdentityService.resolveMediaIdentity(client, itemId);
      return {
        Item: await this.metadataDetailCoreService.buildMetadataView(client, identity, input.language ?? null),
      };
    });
  }

  async getItemDetail(itemId: string, language?: string | null): Promise<MetadataTitleDetail> {
    return this.metadataTitlePageService.getTitlePage(itemId, language ?? null);
  }
}
