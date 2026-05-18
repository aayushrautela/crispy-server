import type { DbClient } from '../../lib/db.js';
import type { MediaIdentity } from '../identity/media-key.js';
import { buildDetailBaseItemDto } from './metadata-detail.builders.js';
import type { BaseItemDto } from './media-item.types.js';
import { MetadataTitleSourceService } from './metadata-title-source.service.js';

export class MetadataDetailCoreService {
  constructor(
    private readonly titleSourceService = new MetadataTitleSourceService(),
  ) {}

  async buildMetadataView(client: DbClient, identity: MediaIdentity, language?: string | null): Promise<BaseItemDto> {
    const source = await this.titleSourceService.loadTitleSource(client, identity, language ?? null);
    return buildDetailBaseItemDto({
      identity,
      title: source.tmdbTitle,
      currentEpisode: null,
      nextEpisode: source.tmdbNextEpisode,
      language: language ?? null,
    });
  }
}
