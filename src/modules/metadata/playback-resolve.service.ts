import type { DbClient } from '../../lib/db.js';
import { withDbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import type { SupportedMediaType } from '../identity/media-key.js';
import { inferMediaIdentity, parseMediaKey, type MediaIdentity } from '../identity/media-key.js';
import { buildSeasonViewFromRecord } from './metadata-detail.builders.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
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
  ) {}

  async resolvePlayback(input: ResolveMetadataInput): Promise<PlaybackResolveResponse> {
    return withDbClient(async (client) => {
      const identity = await this.resolveIdentity(client, input);
      const item = await this.metadataDetailCoreService.buildMetadataView(client, identity, input.language ?? null);
      let show: MetadataView | null = null;
      let season: MetadataSeasonView | null = null;

      if (identity.mediaType === 'episode' && identity.showTmdbId) {
        const showIdentity = inferMediaIdentity({
          mediaType: 'show',
          provider: 'tmdb',
          providerId: identity.showTmdbId,
          tmdbId: identity.showTmdbId,
        });
        show = await this.metadataDetailCoreService.buildMetadataView(client, showIdentity, input.language ?? null);

        if (identity.seasonNumber !== null) {
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

    if (mediaType === 'episode') {
      const showTmdbId = await this.resolveShowTmdbId(client, input);
      if (!showTmdbId) {
        throw new HttpError(404, 'Metadata title not found.');
      }

      return inferMediaIdentity({
        mediaType: 'episode',
        provider: 'tmdb',
        parentProvider: 'tmdb',
        parentProviderId: String(showTmdbId),
        showTmdbId,
        seasonNumber: requireSeasonNumber(input.seasonNumber),
        episodeNumber: requireEpisodeNumber(input.episodeNumber),
      });
    }

    const tmdbId = await this.resolveTitleTmdbId(client, input, mediaType);
    if (!tmdbId) {
      throw new HttpError(404, 'Metadata title not found.');
    }

    return inferMediaIdentity({ mediaType, tmdbId });
  }

  private async resolveShowTmdbId(client: DbClient, input: ResolveMetadataInput): Promise<number | null> {
    if (typeof input.tmdbId === 'number' && Number.isInteger(input.tmdbId) && input.tmdbId > 0) {
      return input.tmdbId;
    }

    const imdbId = normalizeImdbId(input.imdbId ?? null);
    if (!imdbId) {
      return null;
    }

    return this.externalIdResolver.resolve(client, {
      source: 'imdb_id',
      externalId: imdbId,
      mediaType: 'show',
    });
  }

  private async resolveTitleTmdbId(
    client: DbClient,
    input: ResolveMetadataInput,
    mediaType: Extract<SupportedMediaType, 'movie' | 'show'>,
  ): Promise<number | null> {
    if (typeof input.tmdbId === 'number' && Number.isInteger(input.tmdbId) && input.tmdbId > 0) {
      return input.tmdbId;
    }

    const imdbId = normalizeImdbId(input.imdbId ?? null);
    if (!imdbId) {
      return null;
    }

    return this.externalIdResolver.resolve(client, {
      source: 'imdb_id',
      externalId: imdbId,
      mediaType: normalizeTmdbResolvableMediaType(mediaType),
    });
  }
}

function normalizeResolveMediaType(
  mediaType: SupportedMediaType | null | undefined,
  seasonNumber: number | null | undefined,
  episodeNumber: number | null | undefined,
): Extract<SupportedMediaType, 'movie' | 'show' | 'episode'> {
  if (mediaType === 'movie' || mediaType === 'show' || mediaType === 'episode') {
    return mediaType;
  }

  if (seasonNumber !== null && seasonNumber !== undefined && episodeNumber !== null && episodeNumber !== undefined) {
    return 'episode';
  }

  return 'movie';
}

function normalizeTmdbResolvableMediaType(mediaType: Extract<SupportedMediaType, 'movie' | 'show'>): 'movie' | 'show' {
  return mediaType === 'show' ? 'show' : 'movie';
}

function requireSeasonNumber(value: number | null | undefined): number {
  if (value === null || value === undefined) {
    throw new HttpError(400, 'Episode resolution requires show id, season number, and episode number.');
  }
  return value;
}

function requireEpisodeNumber(value: number | null | undefined): number {
  if (value === null || value === undefined) {
    throw new HttpError(400, 'Episode resolution requires show id, season number, and episode number.');
  }
  return value;
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
