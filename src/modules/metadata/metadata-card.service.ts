import type { DbClient } from '../../lib/db.js';
import type { MediaIdentity } from '../identity/media-key.js';
import { ContentIdentityService, type EpisodeParentItemIds } from '../identity/content-identity.service.js';
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

  async buildCardViews(client: DbClient, identities: MediaIdentity[], language?: string | null): Promise<(MetadataCardView | null)[]> {
    if (!identities.length) {
      return [];
    }
    const normalizedLanguage = language ?? null;

    const titleSources = await this.titleSourceService.loadTitleSources(client, identities, normalizedLanguage);
    const contentIds = await this.contentIdentityService.ensureContentIds(client, identities);

    const episodeItemIds: string[] = [];
    for (const identity of identities) {
      if (identity.mediaType === 'episode') {
        const contentId = contentIds.get(identity.mediaKey);
        if (contentId) {
          episodeItemIds.push(encodePublicItemId(contentId));
        }
      }
    }
    const parentIds = episodeItemIds.length
      ? await this.contentIdentityService.resolveParentItemIdsForEpisodes(client, episodeItemIds)
      : new Map<string, EpisodeParentItemIds>();

    return identities.map((identity) => {
      const contentId = contentIds.get(identity.mediaKey);
      if (!contentId) {
        return null;
      }

      const source = titleSources.get(identity.mediaKey);
      const itemId = encodePublicItemId(contentId);
      const parents = identity.mediaType === 'episode'
        ? (parentIds.get(itemId) ?? { seriesItemId: null, seasonItemId: null })
        : { seriesItemId: null, seasonItemId: null };

      return buildMetadataCardView({
        identity,
        itemId,
        seriesItemId: parents.seriesItemId,
        seasonItemId: parents.seasonItemId,
        title: source?.tmdbTitle ?? null,
        currentEpisode: source?.tmdbCurrentEpisode ?? null,
        language: normalizedLanguage,
      });
    });
  }
}
