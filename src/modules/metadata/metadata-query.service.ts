import type { DbClient } from '../../lib/db.js';
import { withTransaction } from '../../lib/db.js';
import { assertPresent, HttpError } from '../../lib/errors.js';
import type { SupportedMediaType } from '../watch/media-key.js';
import { inferMediaIdentity } from '../watch/media-key.js';
import { parseMetadataId } from './metadata-normalizers.js';
import { MetadataViewService } from './metadata-view.service.js';
import { TmdbExternalIdResolverService } from './tmdb-external-id-resolver.service.js';
import { TmdbCacheService } from './tmdb-cache.service.js';
import type {
  MetadataResolveResponse,
  MetadataSearchResponse,
  TmdbTitleRecord,
  MetadataTitleDetail,
  MetadataSeasonDetail,
} from './tmdb.types.js';

type ResolveInput = {
  id?: string;
  tmdbId?: number | null;
  imdbId?: string | null;
  tvdbId?: number | null;
  mediaType?: SupportedMediaType | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
};

export class MetadataQueryService {
  constructor(
    private readonly metadataViewService = new MetadataViewService(),
    private readonly externalIdResolver = new TmdbExternalIdResolverService(),
    private readonly tmdbCacheService = new TmdbCacheService(),
  ) {}

  async resolve(input: ResolveInput): Promise<MetadataResolveResponse> {
    return withTransaction(async (client) => {
      const identity = await this.resolveIdentity(client, input);
      return {
        item: await this.metadataViewService.buildMetadataView(client, identity),
      };
    });
  }

  async getTitleDetailById(id: string): Promise<MetadataTitleDetail> {
    return withTransaction(async (client) => {
      const identity = parseMetadataId(id);
      if (identity.mediaType === 'episode') {
        return this.metadataViewService.getTitleDetail(client, {
          ...identity,
          mediaType: 'show',
          mediaKey: `show:tmdb:${identity.showTmdbId}`,
          tmdbId: identity.showTmdbId,
          seasonNumber: null,
          episodeNumber: null,
        });
      }

      return this.metadataViewService.getTitleDetail(client, identity);
    });
  }

  async getSeasonDetailByShowId(showId: string, seasonNumber: number): Promise<MetadataSeasonDetail> {
    return withTransaction(async (client) => {
      const identity = parseMetadataId(showId);
      if (identity.mediaType !== 'show' || !identity.tmdbId) {
        throw new HttpError(400, 'Season details require a show id.');
      }

      return this.metadataViewService.getSeasonDetail(client, identity.tmdbId, seasonNumber);
    });
  }

  async searchTitles(query: string, limit = 20): Promise<MetadataSearchResponse> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      return {
        query: normalizedQuery,
        items: [],
      };
    }

    return withTransaction(async (client) => {
      const matches = await this.tmdbCacheService.searchTitles(client, normalizedQuery, limit);
      const items = await this.metadataViewService.buildViews(
        client,
        matches.map((match: TmdbTitleRecord) =>
          inferMediaIdentity({
            mediaType: match.mediaType === 'movie' ? 'movie' : 'show',
            tmdbId: match.tmdbId,
          }),
        ),
      );

      return {
        query: normalizedQuery,
        items,
      };
    });
  }

  private async resolveIdentity(client: DbClient, input: ResolveInput) {
    if (input.id?.trim()) {
      return parseMetadataId(input.id.trim());
    }

    const mediaType = normalizeResolveMediaType(input.mediaType, input.seasonNumber, input.episodeNumber);
    const showTmdbId = await this.resolveTmdbId(client, input, mediaType);

    if (mediaType === 'episode') {
      if (!showTmdbId || input.seasonNumber === null || input.seasonNumber === undefined || input.episodeNumber === null || input.episodeNumber === undefined) {
        throw new HttpError(400, 'Episode resolution requires show id, season number, and episode number.');
      }

      return inferMediaIdentity({
        mediaType: 'episode',
        showTmdbId,
        seasonNumber: input.seasonNumber,
        episodeNumber: input.episodeNumber,
      });
    }

    const tmdbId = assertPresent(showTmdbId, 'Unable to resolve metadata identity.');
    return inferMediaIdentity({
      mediaType,
      tmdbId,
    });
  }

  private async resolveTmdbId(
    client: DbClient,
    input: ResolveInput,
    mediaType: SupportedMediaType,
  ): Promise<number | null> {
    if (typeof input.tmdbId === 'number' && Number.isInteger(input.tmdbId) && input.tmdbId > 0) {
      return input.tmdbId;
    }

    if (input.imdbId?.trim()) {
      return this.externalIdResolver.resolve(client, {
        source: 'imdb_id',
        externalId: input.imdbId,
        mediaType,
      });
    }

    if (typeof input.tvdbId === 'number' && Number.isInteger(input.tvdbId) && input.tvdbId > 0) {
      return this.externalIdResolver.resolve(client, {
        source: 'tvdb_id',
        externalId: String(input.tvdbId),
        mediaType,
      });
    }

    return null;
  }
}

function normalizeResolveMediaType(
  mediaType: SupportedMediaType | null | undefined,
  seasonNumber: number | null | undefined,
  episodeNumber: number | null | undefined,
): SupportedMediaType {
  if (mediaType === 'movie' || mediaType === 'show' || mediaType === 'episode') {
    return mediaType;
  }

  if (seasonNumber !== null && seasonNumber !== undefined && episodeNumber !== null && episodeNumber !== undefined) {
    return 'episode';
  }

  return 'movie';
}
