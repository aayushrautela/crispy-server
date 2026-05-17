import type { DbClient } from '../../lib/db.js';
import { assertPresent } from '../../lib/errors.js';
import type { MediaIdentity } from '../identity/media-key.js';
import {
  buildEpisodeView,
  buildMetadataView,
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
  ) {}

  async buildTitleDetail(client: DbClient, identity: MediaIdentity, language?: string | null): Promise<MetadataTitleDetail> {
    if (identity.mediaType !== 'movie' && identity.mediaType !== 'show') {
      throw new Error('Title detail normalization requires a title identity.');
    }

    const source = await this.titleSourceService.loadTitleSource(client, identity, language ?? null);

    const resolvedTitle = assertPresent(source.tmdbTitle, 'Metadata title not found.');

    return {
      item: buildMetadataView({ identity, title: resolvedTitle, currentEpisode: null, nextEpisode: source.tmdbNextEpisode, language: language ?? null }),
      nextEpisode: source.tmdbNextEpisode
        ? buildEpisodeView(resolvedTitle, source.tmdbNextEpisode, '', '')
        : null,
      videos: extractVideos(resolvedTitle),
      cast: extractCast(resolvedTitle),
      directors: extractCrewByJob(resolvedTitle, 'Director'),
      creators: extractCreators(resolvedTitle),
      production: extractProduction(resolvedTitle),
    };
  }

}
