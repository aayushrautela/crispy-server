import type { DbClient } from '../../lib/db.js';
import { assertPresent } from '../../lib/errors.js';
import type { MediaIdentity } from '../identity/media-key.js';
import { ContentIdentityService, episodeRefMapKey } from '../identity/content-identity.service.js';
import { encodePublicItemId } from '../identity/public-item-id.js';
import {
  buildDetailBaseItemDto,
  buildEpisodeBaseItemDto,
} from './metadata-detail.builders.js';
import type {
  MetadataTitleDetail,
} from './metadata-detail.types.js';
import {
  extractCast,
  extractCreators,
  extractCrewByJob,
  extractProduction,
  extractVideos,
} from './metadata-builder.shared.js';
import { MetadataTitleSourceService } from './metadata-title-source.service.js';

export class MetadataTitleAggregateBuilder {
  constructor(
    private readonly titleSourceService = new MetadataTitleSourceService(),
    private readonly contentIdentityService = new ContentIdentityService(),
  ) {}

  async buildTitleDetail(client: DbClient, identity: MediaIdentity, language?: string | null): Promise<MetadataTitleDetail> {
    if (identity.mediaType !== 'movie' && identity.mediaType !== 'show') {
      throw new Error('Title detail normalization requires a title identity.');
    }

    const source = await this.titleSourceService.loadTitleSource(client, identity, language ?? null);

    const resolvedTitle = assertPresent(source.tmdbTitle, 'Metadata title not found.');
    const itemId = encodePublicItemId(identity.contentId ?? await this.contentIdentityService.ensureContentId(client, identity));
    const nextEpisodeContentId = source.tmdbNextEpisode
      ? await this.contentIdentityService.ensureEpisodeContentId(client, {
        parentMediaType: 'show',
        provider: 'tmdb',
        parentProviderId: String(resolvedTitle.tmdbId),
        seasonNumber: source.tmdbNextEpisode.seasonNumber,
        episodeNumber: source.tmdbNextEpisode.episodeNumber,
      })
      : null;
    const nextEpisodeItemId = nextEpisodeContentId ? encodePublicItemId(nextEpisodeContentId) : null;
    const nextEpisodeParents = nextEpisodeItemId
      ? await this.contentIdentityService.resolveParentItemIdsForEpisode(client, nextEpisodeItemId)
      : null;

    return {
      Item: buildDetailBaseItemDto({ identity, itemId, title: resolvedTitle, currentEpisode: null, nextEpisode: source.tmdbNextEpisode, language: language ?? null }),
      NextEpisode: source.tmdbNextEpisode && nextEpisodeItemId && nextEpisodeParents?.seriesItemId
        ? buildEpisodeBaseItemDto(resolvedTitle, source.tmdbNextEpisode, nextEpisodeItemId, nextEpisodeParents.seriesItemId, nextEpisodeParents.seasonItemId)
        : null,
      Videos: extractVideos(resolvedTitle),
      Cast: extractCast(resolvedTitle),
      Directors: extractCrewByJob(resolvedTitle, 'Director'),
      Creators: extractCreators(resolvedTitle),
      Production: extractProduction(resolvedTitle),
    };
  }

}
