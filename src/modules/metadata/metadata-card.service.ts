import type { DbClient } from '../../lib/db.js';
import type { MediaIdentity } from '../identity/media-key.js';
import { MetadataViewService } from './metadata-view.service.js';
import type { MetadataCardView } from './metadata.types.js';

export class MetadataCardService {
  constructor(
    private readonly metadataViewService = new MetadataViewService(),
  ) {}

  async buildCardView(client: DbClient, identity: MediaIdentity): Promise<MetadataCardView> {
    return this.metadataViewService.buildMetadataCardView(client, identity);
  }

  async buildCardViewFromRow(client: DbClient, row: Record<string, unknown>): Promise<MetadataCardView> {
    return this.metadataViewService.buildMetadataCardViewFromRow(client, row);
  }

  async buildCardViews(client: DbClient, identities: MediaIdentity[]): Promise<MetadataCardView[]> {
    return this.metadataViewService.buildCardViews(client, identities);
  }
}
