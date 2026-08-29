import type { DbClient } from '../../lib/db.js';
import type { MediaIdentity } from '../identity/media-key.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { encodePublicItemId } from '../identity/public-item-id.js';
import { buildMetadataCardView } from './metadata-card.builders.js';
import type { ClientMediaCard } from '../recommendations/client-home.types.js';
import { toClientMediaCard } from './client-media-card.mapper.js';
import { MetadataTitleSourceService } from './metadata-title-source.service.js';
import { extractExternalIds } from './metadata-builder.shared.js';
import { imdbTrailerService } from './enrichment/imdb-trailer.service.js';

export class MetadataDetailCoreService {
  constructor(
    private readonly titleSourceService = new MetadataTitleSourceService(),
    private readonly contentIdentityService = new ContentIdentityService(),
  ) {}

  async buildMetadataView(client: DbClient, identity: MediaIdentity, language?: string | null): Promise<ClientMediaCard> {
    const source = await this.titleSourceService.loadTitleSource(client, identity, language ?? null);
    const itemId = encodePublicItemId(identity.contentId ?? await this.contentIdentityService.ensureContentId(client, identity));
    const parentIds = identity.mediaType === 'episode'
      ? await this.contentIdentityService.resolveParentItemIdsForEpisode(client, itemId)
      : { seriesItemId: null, seasonItemId: null };
    const resolvedTitle = source.tmdbTitle;
    const cardView = buildMetadataCardView({
      identity,
      itemId,
      seriesItemId: parentIds.seriesItemId,
      seasonItemId: parentIds.seasonItemId,
      title: resolvedTitle,
      currentEpisode: identity.mediaType === 'episode' ? source.tmdbCurrentEpisode : null,
      language: language ?? null,
    });
    const card = toClientMediaCard(cardView, { progress: null });
    if (resolvedTitle) {
      const imdbId = extractExternalIds(resolvedTitle).imdb;
      if (imdbId) {
        const imdbTrailer = await imdbTrailerService.resolveTrailer(imdbId, identity.seasonNumber);
        if (imdbTrailer) {
          return { ...card, trailerUrl: imdbTrailer.url };
        }
      }
    }
    return card;
  }
}
