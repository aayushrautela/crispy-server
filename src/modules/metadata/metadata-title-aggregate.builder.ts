import type { DbClient } from '../../lib/db.js';
import { logger } from '../../config/logger.js';
import { assertPresent } from '../../lib/errors.js';
import type { MediaIdentity } from '../identity/media-key.js';
import { inferMediaIdentity } from '../identity/media-key.js';
import { ContentIdentityService, episodeRefMapKey } from '../identity/content-identity.service.js';
import { encodePublicItemId } from '../identity/public-item-id.js';
import { imdbTrailerService } from './enrichment/imdb-trailer.service.js';
import {
  buildMetadataCardView,
} from './metadata-card.builders.js';
import type { ClientMediaCard } from '../recommendations/client-home.types.js';
import { toClientMediaCard } from './client-media-card.mapper.js';
import type {
  MetadataTitleDetail,
} from './metadata-detail.types.js';
import {
  extractBackdropPaths,
  extractCast,
  extractCreators,
  extractCrewByJob,
  extractExternalIds,
  extractProduction,
  extractVideos,
} from './metadata-builder.shared.js';
import type { TmdbTitleRecord } from './providers/tmdb.types.js';
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
    const imdbId = extractExternalIds(resolvedTitle).imdb;

    const [item, imdbTrailer, nextEpisode] = await Promise.all([
      Promise.resolve(buildMetadataCardView({ identity, itemId, title: resolvedTitle, currentEpisode: null, language: language ?? null })).then((view: import('./metadata-card.types.js').MetadataCardView) => toClientMediaCard(view, { progress: null })),
      imdbId ? imdbTrailerService.resolveTrailer(imdbId, identity.seasonNumber) : Promise.resolve(null),
      this.buildNextEpisode(client, resolvedTitle, source.tmdbNextEpisode),
    ]);

    return {
      Item: applyImdbTrailer(item, imdbTrailer),
      NextEpisode: nextEpisode,
      Videos: extractVideos(resolvedTitle),
      Cast: await extractCast(client, this.contentIdentityService, resolvedTitle),
      Creators: await extractCreators(client, this.contentIdentityService, resolvedTitle),
      Directors: await extractCrewByJob(client, this.contentIdentityService, resolvedTitle, 'Director'),
      Production: extractProduction(resolvedTitle),
      Backdrops: extractBackdropPaths(resolvedTitle.raw),
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
      if (!nextEpisodeParents.seriesItemId) {
        return null;
      }
      const nextEpisodeIdentity = inferMediaIdentity({
        mediaType: 'episode',
        provider: 'tmdb',
        providerId: String(nextEpisode.tmdbId),
        tmdbId: nextEpisode.tmdbId,
        showTmdbId: title.tmdbId,
        seasonNumber: nextEpisode.seasonNumber,
        episodeNumber: nextEpisode.episodeNumber,
        contentId: nextEpisodeContentId,
      });
      const view = buildMetadataCardView({
        identity: nextEpisodeIdentity,
        itemId: nextEpisodeItemId,
        seriesItemId: nextEpisodeParents.seriesItemId,
        seasonItemId: nextEpisodeParents.seasonItemId,
        title,
        currentEpisode: nextEpisode,
        language: null,
      });
      return toClientMediaCard(view, { progress: null, seriesTitle: title.name ?? title.originalName ?? undefined });
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

function applyImdbTrailer(
  card: ClientMediaCard,
  imdbTrailer: Awaited<ReturnType<typeof imdbTrailerService.resolveTrailer>> | null,
): ClientMediaCard {
  if (!imdbTrailer) {
    return card;
  }
  return { ...card, trailerUrl: imdbTrailer.url };
}
