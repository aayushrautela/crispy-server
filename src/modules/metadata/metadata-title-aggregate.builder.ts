import type { DbClient } from '../../lib/db.js';
import { assertPresent } from '../../lib/errors.js';
import type { MediaIdentity } from '../identity/media-key.js';
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
  ) {}

  async buildTitleDetail(client: DbClient, identity: MediaIdentity, language?: string | null): Promise<MetadataTitleDetail> {
    if (identity.mediaType !== 'movie' && identity.mediaType !== 'show') {
      throw new Error('Title detail normalization requires a title identity.');
    }

    const source = await this.titleSourceService.loadTitleSource(client, identity, language ?? null);

    const resolvedTitle = assertPresent(source.tmdbTitle, 'Metadata title not found.');

    return {
      Item: buildDetailBaseItemDto({ identity, title: resolvedTitle, currentEpisode: null, nextEpisode: source.tmdbNextEpisode, language: language ?? null }),
      NextEpisode: source.tmdbNextEpisode
        ? buildEpisodeBaseItemDto(resolvedTitle, source.tmdbNextEpisode, '', '')
        : null,
      Videos: extractVideos(resolvedTitle),
      Cast: extractCast(resolvedTitle),
      Directors: extractCrewByJob(resolvedTitle, 'Director'),
      Creators: extractCreators(resolvedTitle),
      Production: extractProduction(resolvedTitle),
    };
  }

}
