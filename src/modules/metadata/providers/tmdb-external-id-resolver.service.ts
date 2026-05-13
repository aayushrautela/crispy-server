import type { DbClient } from '../../../lib/db.js';
import { TmdbClient } from './tmdb.client.js';
import { TmdbExternalIdsRepository } from './tmdb-external-ids.repo.js';
import { TmdbResponseCacheService } from './tmdb-response-cache.service.js';
import type { TmdbTitleType } from './tmdb.types.js';

type ResolveExternalIdParams = {
  source: 'imdb_id' | 'tvdb_id';
  externalId: string;
  mediaType: 'movie' | 'show' | 'episode';
};

export class TmdbExternalIdResolverService {
  constructor(
    private readonly externalIdsRepository = new TmdbExternalIdsRepository(),
    private readonly tmdbClient = new TmdbClient(),
    private readonly responseCache = new TmdbResponseCacheService(),
  ) {}

  async resolve(client: DbClient, params: ResolveExternalIdParams): Promise<number | null> {
    const normalizedExternalId = params.externalId.trim();
    if (!normalizedExternalId) {
      return null;
    }

    const mediaType = normalizeExternalMediaType(params.mediaType);
    const cached = await this.externalIdsRepository.findByExternalId(client, {
      source: params.source,
      externalId: normalizedExternalId,
      mediaType,
    });
    if (cached) {
      return cached.tmdbId;
    }

    const response = await this.responseCache.getOrFetch(
      client,
      {
        resourceType: 'external_id',
        resourceId: `${params.source}:${normalizedExternalId}`,
        variant: mediaType,
        language: null,
        requestPath: `/find/${encodeURIComponent(normalizedExternalId)}`,
        requestQuery: { external_source: params.source },
      },
      'external:positive',
      () => this.tmdbClient.request(`/find/${encodeURIComponent(normalizedExternalId)}`, { external_source: params.source }),
    );

    if (response.isNegative || response.statusCode === 404) {
      return null;
    }

    const match = extractFindMatch(response.responseJson, params.mediaType);
    if (!match) {
      return null;
    }

    await this.externalIdsRepository.upsert(client, {
      source: params.source,
      externalId: normalizedExternalId,
      mediaType,
      tmdbId: match.tmdbId,
      raw: match.raw,
    });

    return match.tmdbId;
  }
}

function extractFindMatch(payload: Record<string, unknown>, mediaType: 'movie' | 'show' | 'episode'): {
  tmdbId: number;
  raw: Record<string, unknown>;
} | null {
  if (mediaType === 'movie') {
    return firstTmdbMatch(payload.movie_results);
  }

  const tvMatch = firstTmdbMatch(payload.tv_results);
  if (tvMatch) {
    return tvMatch;
  }

  if (mediaType === 'episode') {
    return firstTmdbMatch(payload.tv_episode_results);
  }

  return null;
}

function firstTmdbMatch(value: unknown): { tmdbId: number; raw: Record<string, unknown> } | null {
  if (!Array.isArray(value)) {
    return null;
  }

  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== 'number' || !Number.isFinite(item.id)) {
      continue;
    }
    return {
      tmdbId: item.id,
      raw: item,
    };
  }

  return null;
}

function normalizeExternalMediaType(mediaType: 'movie' | 'show' | 'episode'): TmdbTitleType | 'episode' {
  if (mediaType === 'show') {
    return 'tv';
  }
  return mediaType;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
