import { withDbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { MetadataDetailCoreService } from './metadata-detail-core.service.js';
import { MetadataEnrichmentService } from './metadata-enrichment.service.js';
import { resolveTitleRouteIdentity } from './metadata-detail.service.js';
import type { MetadataTitleContentResponse, MetadataView } from './metadata-detail.types.js';

export class MetadataContentService {
  constructor(
    private readonly metadataDetailCoreService = new MetadataDetailCoreService(),
    private readonly contentIdentityService = new ContentIdentityService(),
    private readonly metadataEnrichmentService = new MetadataEnrichmentService(),
  ) {}

  async resolveTitleMetadataView(id: string): Promise<MetadataView> {
    return withDbClient(async (client) => {
      const identity = await resolveTitleRouteIdentity(client, this.contentIdentityService, id);
      if (identity.mediaType !== 'movie' && identity.mediaType !== 'show' && identity.mediaType !== 'anime') {
        throw new HttpError(400, 'Title content requires a title mediaKey.');
      }

      return this.metadataDetailCoreService.buildMetadataView(client, identity);
    });
  }

  async getTitleContent(userId: string, id: string): Promise<MetadataTitleContentResponse> {
    const item = await this.resolveTitleMetadataView(id);
    const content = await this.metadataEnrichmentService.getTitleContent(userId, item);
    return { item, content };
  }
}
