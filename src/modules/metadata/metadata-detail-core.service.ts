import type { DbClient } from '../../lib/db.js';
import type { MediaIdentity } from '../identity/media-key.js';
import { buildMetadataView } from './metadata-detail.builders.js';
import type { MetadataView } from './metadata-detail.types.js';
import { MetadataTitleSourceService } from './metadata-title-source.service.js';

export class MetadataDetailCoreService {
  constructor(
    private readonly titleSourceService = new MetadataTitleSourceService(),
  ) {}

  async buildMetadataView(client: DbClient, identity: MediaIdentity, language?: string | null): Promise<MetadataView> {
    const source = await this.titleSourceService.loadTitleSource(client, identity, language ?? null);
    return buildMetadataView({
      identity,
      title: source.tmdbTitle,
      currentEpisode: null,
      nextEpisode: source.tmdbNextEpisode,
    });
  }
}
