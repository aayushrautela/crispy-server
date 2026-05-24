import type { DbClient } from '../../lib/db.js';
import { logger } from '../../config/logger.js';
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
    const nextEpisode = await this.buildNextEpisode(client, resolvedTitle, source.tmdbNextEpisode);

    return {
      Item: buildDetailBaseItemDto({ identity, itemId, title: resolvedTitle, currentEpisode: null, nextEpisode: source.tmdbNextEpisode, language: language ?? null }),
      NextEpisode: nextEpisode,
      Videos: extractVideos(resolvedTitle),
      Cast: await extractCast(client, this.contentIdentityService, resolvedTitle),
      Directors: await extractCrewByJob(client, this.contentIdentityService, resolvedTitle, 'Director'),
      Creators: await extractCreators(client, this.contentIdentityService, resolvedTitle),
      Production: extractProduction(resolvedTitle),
    };
  }

  private async buildNextEpisode(client: DbClient, title: NonNullable<Awaited<ReturnType<MetadataTitleSourceService['loadTitleSource']>>['tmdbTitle']>, nextEpisode: Awaited<ReturnType<MetadataTitleSourceService['loadTitleSource']>>['tmdbNextEpisode']): Promise<MetadataTitleDetail['NextEpisode']> {
    if (!nextEpisode) {
      return null;
    }

    try {
      const nextEpisodeContentId = await this.contentIdentityService.ensureEpisodeContentId(client, {
        parentMediaType: 'show',
        provider: 'tmdb',
        parentProviderId: String(title.tmdbId),
        seasonNumber: nextEpisode.seasonNumber,
        episodeNumber: nextEpisode.episodeNumber,
      });
      const nextEpisodeItemId = encodePublicItemId(nextEpisodeContentId);
      const nextEpisodeParents = await this.contentIdentityService.resolveParentItemIdsForEpisode(client, nextEpisodeItemId);
      return nextEpisodeParents.seriesItemId
        ? buildEpisodeBaseItemDto(title, nextEpisode, nextEpisodeItemId, nextEpisodeParents.seriesItemId, nextEpisodeParents.seasonItemId)
        : null;
    } catch (error) {
      logger.warn({
        err: error,
        tmdbId: title.tmdbId,
        seasonNumber: nextEpisode.seasonNumber,
        episodeNumber: nextEpisode.episodeNumber,
        episodeTmdbId: nextEpisode.tmdbId,
      }, 'failed to build title next episode');
      return null;
    }
  }

}
