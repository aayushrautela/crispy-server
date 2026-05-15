import type { DbClient } from '../../lib/db.js';
import { assertPresent } from '../../lib/errors.js';
import { type MediaIdentity } from '../identity/media-key.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import {
  buildEpisodeView,
  buildMetadataView,
  buildSeasonViewFromTitleRaw,
} from './metadata-detail.builders.js';
import type {
  MetadataTitleDetail,
} from './metadata-detail.types.js';
import {
  extractCast,
  extractCollection,
  extractCreators,
  extractCrewByJob,
  extractExtraVideos,
  extractProduction,
  extractVideos,
} from './metadata-builder.shared.js';
import type { TmdbTitleRecord } from './providers/tmdb.types.js';
import { MetadataTitleSourceService } from './metadata-title-source.service.js';

export class MetadataTitleAggregateBuilder {
  constructor(
    private readonly contentIdentityService = new ContentIdentityService(),
    private readonly titleSourceService = new MetadataTitleSourceService(),
  ) {}

  async buildTitleDetail(client: DbClient, identity: MediaIdentity, language?: string | null): Promise<MetadataTitleDetail> {
    if (identity.mediaType !== 'movie' && identity.mediaType !== 'show') {
      throw new Error('Title detail normalization requires a title identity.');
    }

    const source = await this.titleSourceService.loadTitleSource(client, identity, language ?? null);

    const resolvedTitle = assertPresent(source.tmdbTitle, 'Metadata title not found.');
    const seasonNumbers = extractSeasonNumbersFromTitle(resolvedTitle);
    const seasonIds = await this.contentIdentityService.ensureSeasonContentIds(client, {
      parentMediaType: 'show',
      provider: 'tmdb',
      parentProviderId: resolvedTitle.tmdbId,
    }, seasonNumbers);
    const collection = extractCollection(resolvedTitle);

    return {
      item: buildMetadataView({ identity, title: resolvedTitle, currentEpisode: null, nextEpisode: source.tmdbNextEpisode, language: language ?? null }),
      seasons: buildSeasonViewFromTitleRaw(resolvedTitle, seasonIds),
      episodes: [],
      nextEpisode: source.tmdbNextEpisode
        ? buildEpisodeView(resolvedTitle, source.tmdbNextEpisode, '', '')
        : null,
      videos: extractVideos(resolvedTitle),
      extraVideos: extractExtraVideos(resolvedTitle),
      cast: extractCast(resolvedTitle),
      directors: extractCrewByJob(resolvedTitle, 'Director'),
      creators: extractCreators(resolvedTitle),
      production: extractProduction(resolvedTitle),
      collection,
      similar: [],
    };
  }

}

function extractSeasonNumbersFromTitle(title: TmdbTitleRecord): number[] {
  const rawSeasons = Array.isArray(title.raw.seasons) ? title.raw.seasons : [];
  return rawSeasons
    .map((entry) => (typeof entry === 'object' && entry !== null ? Number((entry as Record<string, unknown>).season_number) : Number.NaN))
    .filter((seasonNumber) => Number.isInteger(seasonNumber) && seasonNumber >= 0)
    .sort((left, right) => left - right);
}
