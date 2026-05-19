import type { DbClient } from '../../lib/db.js';
import type { MediaIdentity } from '../identity/media-key.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { encodePublicItemId } from '../identity/public-item-id.js';
import type { MetadataCardView } from './metadata-card.types.js';
import { buildMetadataCardView } from './metadata-card.builders.js';
import { MetadataTitleSourceService } from './metadata-title-source.service.js';

export class MetadataCardService {
  constructor(
    private readonly titleSourceService = new MetadataTitleSourceService(),
    private readonly contentIdentityService = new ContentIdentityService(),
  ) {}

  async buildCardView(client: DbClient, identity: MediaIdentity, language?: string | null): Promise<MetadataCardView> {
    const source = await this.titleSourceService.loadTitleSource(client, identity, language ?? null);
    const itemId = encodePublicItemId(identity.contentId ?? await this.contentIdentityService.ensureContentId(client, identity));
    const parentIds = identity.mediaType === 'episode'
      ? await this.contentIdentityService.resolveParentItemIdsForEpisode(client, itemId)
      : { seriesItemId: null, seasonItemId: null };

    return buildMetadataCardView({
      identity,
      itemId,
      seriesItemId: parentIds.seriesItemId,
      seasonItemId: parentIds.seasonItemId,
      title: source.tmdbTitle,
      currentEpisode: source.tmdbCurrentEpisode,
      language: language ?? null,
    });
  }

  async buildCardViews(client: DbClient, identities: MediaIdentity[], language?: string | null): Promise<MetadataCardView[]> {
    return Promise.all(identities.map((identity) => this.buildCardView(client, identity, language)));
  }
}
