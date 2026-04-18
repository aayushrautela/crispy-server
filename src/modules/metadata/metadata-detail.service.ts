import type { DbClient } from '../../lib/db.js';
import { withDbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import type { MediaIdentity, SupportedMediaType } from '../identity/media-key.js';
import { inferMediaIdentity, parseMediaKey } from '../identity/media-key.js';
import { MetadataDetailCoreService } from './metadata-detail-core.service.js';
import { MetadataTitlePageService } from './metadata-title-page.service.js';
import { TmdbExternalIdResolverService } from './providers/tmdb-external-id-resolver.service.js';
import type { MetadataResolveResponse, MetadataTitleDetail } from './metadata-detail.types.js';

type ResolveInput = {
  mediaKey?: string;
  tmdbId?: number | null;
  imdbId?: string | null;
  mediaType?: SupportedMediaType | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  language?: string | null;
};

export class MetadataDetailService {
  constructor(
    private readonly metadataDetailCoreService = new MetadataDetailCoreService(),
    private readonly externalIdResolver = new TmdbExternalIdResolverService(),
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

  private async resolveShowTmdbId(client: DbClient, input: ResolveInput): Promise<number | null> {
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
    input: ResolveInput,
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
