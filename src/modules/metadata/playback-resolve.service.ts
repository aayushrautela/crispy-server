import type { DbClient } from '../../lib/db.js';
import { withDbClient } from '../../lib/db.js';
import { assertPresent, HttpError } from '../../lib/errors.js';
import type { SupportedMediaType } from '../identity/media-key.js';
import { inferMediaIdentity, parseMediaKey, parentMediaTypeForIdentity, type MediaIdentity } from '../identity/media-key.js';
import {
  buildProviderSeasonViewFromRecord,
  buildSeasonViewFromRecord,
} from './metadata-detail.builders.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { ProviderMetadataService } from './provider-metadata.service.js';
import { MetadataDetailCoreService } from './metadata-detail-core.service.js';
import { TmdbExternalIdResolverService } from './providers/tmdb-external-id-resolver.service.js';
import { TmdbCacheService } from './providers/tmdb-cache.service.js';
import type {
  MetadataSeasonView,
  MetadataView,
  PlaybackResolveResponse,
} from './metadata-detail.types.js';

export type ResolveMetadataInput = {
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

export class PlaybackResolveService {
  constructor(
    private readonly metadataDetailCoreService = new MetadataDetailCoreService(),
    private readonly externalIdResolver = new TmdbExternalIdResolverService(),
    private readonly tmdbCacheService = new TmdbCacheService(),
    private readonly contentIdentityService = new ContentIdentityService(),
    private readonly providerMetadataService = new ProviderMetadataService(),
  ) {}

  async resolvePlayback(input: ResolveMetadataInput): Promise<PlaybackResolveResponse> {
    return withDbClient(async (client) => {
      const identity = await this.resolveIdentity(client, input);
      const item = await this.metadataDetailCoreService.buildMetadataView(client, identity, input.language ?? null);
      let show: MetadataView | null = null;
      let season: MetadataSeasonView | null = null;

      if (identity.mediaType === 'episode' && identity.parentProvider && identity.parentProviderId) {
        const parentMediaType = parentMediaTypeForIdentity(identity);
        const showIdentity = inferMediaIdentity({
          mediaType: parentMediaType,
          provider: identity.parentProvider,
          providerId: identity.parentProviderId,
          tmdbId: identity.showTmdbId,
        });
        show = await this.metadataDetailCoreService.buildMetadataView(client, showIdentity, input.language ?? null);

        if (identity.seasonNumber !== null) {
          const providerSeasonContext = await this.providerMetadataService.loadSeasonContext(client, identity, identity.seasonNumber, input.language ?? null);
          if (providerSeasonContext?.season) {
            const seasonId = await this.contentIdentityService.ensureSeasonContentId(client, {
              parentMediaType: providerSeasonContext.season.parentMediaType,
              provider: providerSeasonContext.season.provider,
              parentProviderId: providerSeasonContext.season.parentProviderId,
              seasonNumber: identity.seasonNumber,
            });
            season = buildProviderSeasonViewFromRecord(
              providerSeasonContext.season,
              seasonId,
              '',
              show.externalIds.tmdb ?? null,
            );
          } else if (identity.showTmdbId) {
            const seasonRecord = await this.tmdbCacheService.ensureSeasonCached(client, identity.showTmdbId, identity.seasonNumber);
            if (seasonRecord) {
              const seasonId = await this.contentIdentityService.ensureSeasonContentId(client, {
                parentMediaType: 'show',
                provider: 'tmdb',
                parentProviderId: identity.showTmdbId,
                seasonNumber: identity.seasonNumber,
              });
              season = buildSeasonViewFromRecord(identity.showTmdbId, seasonRecord, seasonId, '');
            }
          }
        }
      }

      return {
        item,
        show,
        season,
      };
    });
  }

  private async resolveIdentity(client: DbClient, input: ResolveMetadataInput): Promise<MediaIdentity> {
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

    const resolvedTmdbId = await this.resolveTmdbId(client, input, mediaType);

    if (mediaType === 'episode') {
      if (!resolvedTmdbId || input.seasonNumber === null || input.seasonNumber === undefined || input.episodeNumber === null || input.episodeNumber === undefined) {
        throw new HttpError(400, 'Episode resolution requires show id, season number, and episode number.');
      }

      return inferMediaIdentity({
        mediaType: 'episode',
        showTmdbId: resolvedTmdbId,
        seasonNumber: input.seasonNumber,
        episodeNumber: input.episodeNumber,
      });
    }

    return inferMediaIdentity({
      mediaType,
      tmdbId: assertPresent(resolvedTmdbId, 'Unable to resolve metadata identity.'),
    });
  }

  private async resolveTmdbId(
    client: DbClient,
    input: ResolveMetadataInput,
    mediaType: SupportedMediaType,
  ): Promise<number | null> {
    if (typeof input.tmdbId === 'number' && Number.isInteger(input.tmdbId) && input.tmdbId > 0) {
      return input.tmdbId;
    }

    const imdbId = normalizeImdbId(input.imdbId ?? null);
    if (imdbId) {
      return this.externalIdResolver.resolve(client, {
        source: 'imdb_id',
        externalId: imdbId,
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
