import type { DbClient } from '../../lib/db.js';
import { withDbClient } from '../../lib/db.js';
import { assertPresent, HttpError } from '../../lib/errors.js';
import type { MediaIdentity, SupportedMediaType } from '../identity/media-key.js';
import { inferMediaIdentity, parseMediaKey } from '../identity/media-key.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { MetadataDetailCoreService } from './metadata-detail-core.service.js';
import { TmdbExternalIdResolverService } from './providers/tmdb-external-id-resolver.service.js';
import { TmdbCacheService } from './providers/tmdb-cache.service.js';
import type { MetadataResolveResponse, MetadataSeasonDetail, MetadataTitleDetail } from './metadata-detail.types.js';

type ResolveInput = {
  mediaKey?: string;
  tmdbId?: number | null;
  imdbId?: string | null;
  tvdbId?: number | null;
  kitsuId?: string | number | null;
  mediaType?: SupportedMediaType | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  language?: string | null;
};

export class MetadataDetailService {
  constructor(
    private readonly metadataDetailCoreService = new MetadataDetailCoreService(),
    private readonly externalIdResolver = new TmdbExternalIdResolverService(),
    private readonly tmdbCacheService = new TmdbCacheService(),
    private readonly contentIdentityService = new ContentIdentityService(),
  ) {}

  async resolve(input: ResolveInput): Promise<MetadataResolveResponse> {
    return withDbClient(async (client) => {
      const identity = await this.resolveIdentity(client, input);
      return {
        item: await this.metadataDetailCoreService.buildMetadataView(client, identity, input.language ?? null),
      };
    });
  }

  async getTitleDetailById(id: string, language?: string | null): Promise<MetadataTitleDetail> {
    return withDbClient(async (client) => {
      const identity = await resolveTitleRouteIdentity(client, this.contentIdentityService, id);
      if (identity.mediaType !== 'movie' && identity.mediaType !== 'show' && identity.mediaType !== 'anime') {
        throw new HttpError(400, 'Title details require a title mediaKey.');
      }

      return this.metadataDetailCoreService.getTitleDetail(client, identity, language ?? null);
    });
  }

  async getSeasonDetailByShowId(showId: string, seasonNumber: number, language?: string | null): Promise<MetadataSeasonDetail> {
    return withDbClient(async (client) => {
      const identity = await resolveShowRouteIdentity(client, this.contentIdentityService, showId);
      if (identity.mediaType !== 'show' && identity.mediaType !== 'anime') {
        throw new HttpError(400, 'Season details require a show or anime mediaKey.');
      }

      return this.metadataDetailCoreService.getSeasonDetail(client, identity, seasonNumber, language ?? null);
    });
  }

  private async resolveIdentity(client: DbClient, input: ResolveInput) {
    if (input.mediaKey?.trim()) {
      return parseMediaKey(input.mediaKey.trim());
    }

    const mediaType = normalizeResolveMediaType(input.mediaType, input.seasonNumber, input.episodeNumber);

    if (mediaType === 'show' && typeof input.tvdbId === 'number' && Number.isInteger(input.tvdbId) && input.tvdbId > 0) {
      return inferMediaIdentity({
        mediaType: 'show',
        provider: 'tvdb',
        providerId: input.tvdbId,
      });
    }

    if (mediaType === 'anime' && input.kitsuId !== null && input.kitsuId !== undefined && String(input.kitsuId).trim()) {
      return inferMediaIdentity({
        mediaType: 'anime',
        provider: 'kitsu',
        providerId: input.kitsuId,
      });
    }

    if (mediaType === 'episode') {
      if (typeof input.tvdbId === 'number' && Number.isInteger(input.tvdbId) && input.tvdbId > 0) {
        if (input.seasonNumber === null || input.seasonNumber === undefined || input.episodeNumber === null || input.episodeNumber === undefined) {
          throw new HttpError(400, 'Episode resolution requires show id, season number, and episode number.');
        }

        return inferMediaIdentity({
          mediaType: 'episode',
          provider: 'tvdb',
          parentProvider: 'tvdb',
          parentProviderId: input.tvdbId,
          seasonNumber: input.seasonNumber,
          episodeNumber: input.episodeNumber,
        });
      }

      if (input.kitsuId !== null && input.kitsuId !== undefined && String(input.kitsuId).trim()) {
        if (input.seasonNumber === null || input.seasonNumber === undefined || input.episodeNumber === null || input.episodeNumber === undefined) {
          throw new HttpError(400, 'Episode resolution requires anime id, season number, and episode number.');
        }

        return inferMediaIdentity({
          mediaType: 'episode',
          provider: 'kitsu',
          parentProvider: 'kitsu',
          parentProviderId: input.kitsuId,
          seasonNumber: input.seasonNumber,
          episodeNumber: input.episodeNumber,
        });
      }
    }

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
        mediaType: normalizeTmdbResolvableMediaType(mediaType),
      });
    }

    if (typeof input.tvdbId === 'number' && Number.isInteger(input.tvdbId) && input.tvdbId > 0) {
      return this.externalIdResolver.resolve(client, {
        source: 'tvdb_id',
        externalId: String(input.tvdbId),
        mediaType: normalizeTmdbResolvableMediaType(mediaType),
      });
    }

    return null;
  }
}

export async function resolveTitleRouteIdentity(
  _client: DbClient,
  _contentIdentityService: ContentIdentityService,
  mediaKey: string,
): Promise<MediaIdentity> {
  const identity = parseMediaKey(mediaKey.trim());
  if (identity.mediaType !== 'movie' && identity.mediaType !== 'show' && identity.mediaType !== 'anime') {
    throw new HttpError(400, 'Title routes require a title mediaKey.');
  }

  return identity;
}

export async function resolveShowRouteIdentity(
  client: DbClient,
  contentIdentityService: ContentIdentityService,
  mediaKey: string,
): Promise<MediaIdentity> {
  const identity = await resolveTitleRouteIdentity(client, contentIdentityService, mediaKey);
  if (identity.mediaType !== 'show' && identity.mediaType !== 'anime') {
    throw new HttpError(400, 'Season routes require a show or anime mediaKey.');
  }

  return identity;
}

function normalizeResolveMediaType(
  mediaType: SupportedMediaType | null | undefined,
  seasonNumber: number | null | undefined,
  episodeNumber: number | null | undefined,
): SupportedMediaType {
  if (mediaType === 'movie' || mediaType === 'show' || mediaType === 'anime' || mediaType === 'episode') {
    return mediaType;
  }

  if (seasonNumber !== null && seasonNumber !== undefined && episodeNumber !== null && episodeNumber !== undefined) {
    return 'episode';
  }

  return 'movie';
}

function normalizeTmdbResolvableMediaType(mediaType: SupportedMediaType): 'movie' | 'show' | 'episode' {
  return mediaType === 'episode' ? 'episode' : mediaType === 'show' ? 'show' : 'movie';
}
