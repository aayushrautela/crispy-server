import type { DbClient } from '../../lib/db.js';
import { withDbClient } from '../../lib/db.js';
import { assertPresent, HttpError } from '../../lib/errors.js';
import type { MediaIdentity, SupportedMediaType } from '../identity/media-key.js';
import { inferMediaIdentity, parseMediaKey } from '../identity/media-key.js';
import { MetadataDetailCoreService } from './metadata-detail-core.service.js';
import { MetadataTitlePageService } from './metadata-title-page.service.js';
import { TmdbExternalIdResolverService } from './providers/tmdb-external-id-resolver.service.js';
import { TmdbCacheService } from './providers/tmdb-cache.service.js';
import { TvdbRemoteIdResolverService } from './providers/tvdb-remote-id-resolver.service.js';
import type { MetadataResolveResponse, MetadataTitleDetail } from './metadata-detail.types.js';

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
    private readonly tvdbRemoteIdResolver = new TvdbRemoteIdResolverService(),
    private readonly metadataTitlePageService = new MetadataTitlePageService(),
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
    return this.metadataTitlePageService.getTitlePage(id, language ?? null);
  }

  private async resolveIdentity(client: DbClient, input: ResolveInput) {
    if (input.mediaKey?.trim()) {
      return parseMediaKey(input.mediaKey.trim());
    }

    const mediaType = normalizeResolveMediaType(input.mediaType, input.seasonNumber, input.episodeNumber);

    if ((mediaType === 'show' || mediaType === 'episode') && typeof input.tmdbId === 'number' && Number.isInteger(input.tmdbId) && input.tmdbId > 0) {
      throw new HttpError(400, 'Show resolution requires a TVDB or IMDB id.');
    }

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
      const resolvedShowTvdbId = await this.resolveShowTvdbId(input);
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

      if (resolvedShowTvdbId) {
        if (input.seasonNumber === null || input.seasonNumber === undefined || input.episodeNumber === null || input.episodeNumber === undefined) {
          throw new HttpError(400, 'Episode resolution requires show id, season number, and episode number.');
        }

        return inferMediaIdentity({
          mediaType: 'episode',
          provider: 'tvdb',
          parentProvider: 'tvdb',
          parentProviderId: resolvedShowTvdbId,
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

    if (mediaType === 'show') {
      const resolvedShowTvdbId = await this.resolveShowTvdbId(input);
      if (!resolvedShowTvdbId) {
        throw new HttpError(404, 'Metadata title not found.');
      }

      return inferMediaIdentity({
        mediaType: 'show',
        provider: 'tvdb',
        providerId: resolvedShowTvdbId,
      });
    }

    const showTmdbId = await this.resolveTmdbId(client, input, mediaType);

    const tmdbId = assertPresent(showTmdbId, 'Unable to resolve metadata identity.');
    return inferMediaIdentity({
      mediaType,
      tmdbId,
    });
  }

  private async resolveShowTvdbId(input: ResolveInput): Promise<string | null> {
    if (typeof input.tvdbId === 'number' && Number.isInteger(input.tvdbId) && input.tvdbId > 0) {
      return String(input.tvdbId);
    }

    const imdbId = normalizeImdbId(input.imdbId ?? null);
    if (!imdbId) {
      return null;
    }

    return this.tvdbRemoteIdResolver.resolveSeriesId(imdbId);
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

function normalizeImdbId(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith('tt')) {
    return trimmed;
  }
  return /^\d+$/.test(trimmed) ? `tt${trimmed}` : null;
}
