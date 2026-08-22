import type { DbClient } from '../../lib/db.js';
import type { MediaIdentity } from '../identity/media-key.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { encodePublicItemId } from '../identity/public-item-id.js';
import { buildDetailBaseItemDto } from './metadata-detail.builders.js';
import type { BaseItemDto } from './media-item.types.js';
import { MetadataTitleSourceService } from './metadata-title-source.service.js';

export class MetadataDetailCoreService {
  constructor(
    private readonly titleSourceService = new MetadataTitleSourceService(),
    private readonly contentIdentityService = new ContentIdentityService(),
  ) {}

  async buildMetadataView(client: DbClient, identity: MediaIdentity, language?: string | null): Promise<BaseItemDto> {
    const source = await this.titleSourceService.loadTitleSource(client, identity, language ?? null);
    const itemId = encodePublicItemId(identity.contentId ?? await this.contentIdentityService.ensureContentId(client, identity));
    const parentIds = identity.mediaType === 'episode'
      ? await this.contentIdentityService.resolveParentItemIdsForEpisode(client, itemId)
      : { seriesItemId: null, seasonItemId: null };
    return buildDetailBaseItemDto({
      identity,
      itemId,
      seriesItemId: parentIds.seriesItemId,
      seasonItemId: parentIds.seasonItemId,
      title: source.tmdbTitle,
      currentEpisode: identity.mediaType === 'episode' ? source.tmdbCurrentEpisode : null,
      nextEpisode: source.tmdbNextEpisode,
      language: language ?? null,
    });
  }
}
