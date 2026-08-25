import type { DbClient } from '../../../lib/db.js';
import { TmdbClient } from './tmdb.client.js';
import { TmdbRepository } from './tmdb.repo.js';
import type { TmdbTitleType } from './tmdb.types.js';

type ResolveExternalIdParams = {
  source: 'imdb_id' | 'tvdb_id';
  externalId: string;
  mediaType: 'movie' | 'show' | 'episode';
};

const NEGATIVE_TTL_MS = 6 * 60 * 60 * 1000;

export class TmdbExternalIdResolverService {
  constructor(
    private readonly tmdbClient = new TmdbClient(),
    private readonly repository = new TmdbRepository(),
  ) {}

  async resolve(client: DbClient, params: ResolveExternalIdParams): Promise<number | null> {
    const normalizedExternalId = params.externalId.trim();
    if (!normalizedExternalId) {
      return null;
    }

    const mediaType = normalizeExternalMediaType(params.mediaType);
    const cached = await this.repository.findByExternalId(client, {
      source: params.source,
      externalId: normalizedExternalId,
      mediaType,
    });
    if (cached) {
      if (cached.tmdbId !== null) {
        return cached.tmdbId;
      }
      if (cached.notFoundAt && Date.now() - cached.notFoundAt.getTime() < NEGATIVE_TTL_MS) {
        return null;
      }
    }

    let payload: Record<string, unknown>;
    try {
      payload = await this.tmdbClient.request(`/find/${encodeURIComponent(normalizedExternalId)}`, { external_source: params.source });
    } catch {
      await this.repository.markExternalIdNotFound(client, {
        source: params.source,
        externalId: normalizedExternalId,
        mediaType,
      });
      return null;
    }

    const match = extractFindMatch(payload, params.mediaType);
    if (!match) {
      await this.repository.markExternalIdNotFound(client, {
        source: params.source,
        externalId: normalizedExternalId,
        mediaType,
      });
      return null;
    }

    await this.repository.upsertExternalId(client, {
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
