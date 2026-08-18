import { db, type DbClient } from '../../../lib/db.js';
import { HttpError } from '../../../lib/errors.js';
import { logger } from '../../../config/logger.js';
import {
  inferMediaIdentity,
  type MediaIdentity,
} from '../../identity/media-key.js';
import type { TmdbExternalIdResolverService } from '../../metadata/providers/tmdb-external-id-resolver.service.js';
import type { TmdbCacheService } from '../../metadata/providers/tmdb-cache.service.js';
import type { MetadataCardService } from '../../metadata/metadata-card.service.js';
import type { ImportIdentityLookup, ResolvedImportIdentity } from '../provider-import.internals.js';

type ResolverDependencies = {
  externalIdResolver: TmdbExternalIdResolverService;
  tmdbCacheService: TmdbCacheService;
  metadataCardService: MetadataCardService;
};

export class TraktImportIdentityResolver {
  constructor(private readonly deps: ResolverDependencies) {}

  async resolve(
    cache: Map<string, ResolvedImportIdentity | null>,
    params: ImportIdentityLookup,
  ): Promise<ResolvedImportIdentity | null> {
    const cacheKey = JSON.stringify({
      mediaFamily: params.mediaFamily,
      tmdbId: params.tmdbId ?? null,
      imdbId: params.imdbId?.trim() ?? null,
      tvdbId: params.tvdbId?.trim() ?? null,
      kitsuId: params.kitsuId ?? null,
    });
    if (cache.has(cacheKey)) {
      return cache.get(cacheKey) ?? null;
    }

    const directTmdbId = params.tmdbId && params.tmdbId > 0 ? params.tmdbId : null;
    const directTvdbId = params.tvdbId?.trim() ? Number(params.tvdbId.trim()) : null;
    const directKitsuId = typeof params.kitsuId === 'number'
      ? String(params.kitsuId)
      : params.kitsuId?.trim() ?? null;
    const imdbId = params.imdbId?.trim();

    if (params.mediaFamily === 'movie' && directTmdbId && !imdbId) {
      const resolved = buildResolvedImportIdentity('movie', {
        providerId: String(directTmdbId),
        tmdbId: directTmdbId,
      });
      return this.validate(cache, cacheKey, resolved, params.title?.trim() || null);
    }

    if (params.mediaFamily === 'movie' && directTmdbId && imdbId) {
      const sourceTitle = params.title?.trim() || null;
      const client = await db.connect();
      try {
        try {
          await this.deps.tmdbCacheService.getTitle(client, 'movie', directTmdbId);
          const resolved = buildResolvedImportIdentity('movie', {
            providerId: String(directTmdbId),
            tmdbId: directTmdbId,
          });
          const validated = await this.validate(cache, cacheKey, resolved, sourceTitle, client);
          if (validated) return validated;
        } catch (error) {
          if (!(error instanceof HttpError) || error.statusCode !== 404) {
            throw error;
          }
        }
        const resolvedTmdbId = await this.deps.externalIdResolver.resolve(client, {
          source: 'imdb_id',
          externalId: imdbId,
          mediaType: 'movie',
        });
        const resolved = resolvedTmdbId
          ? buildResolvedImportIdentity('movie', {
              providerId: String(resolvedTmdbId),
              tmdbId: resolvedTmdbId,
            })
          : null;
        if (!resolved) {
          cache.set(cacheKey, null);
          return null;
        }
        return this.validate(cache, cacheKey, resolved, sourceTitle, client);
      } finally {
        client.release();
      }
    }

    if (
      params.mediaFamily === 'show'
      && Number.isInteger(directTvdbId)
      && (directTvdbId ?? 0) > 0
      && (directTmdbId !== null || !imdbId)
    ) {
      const resolved = buildResolvedImportIdentity('show', {
        providerId: String(directTvdbId),
        tmdbId: directTmdbId,
      });
      return this.validate(cache, cacheKey, resolved, params.title?.trim() || null);
    }

    if (params.mediaFamily === 'anime' && directKitsuId) {
      const resolved = buildResolvedImportIdentity('show', {
        providerId: directKitsuId,
        tmdbId: directTmdbId,
      });
      return this.validate(cache, cacheKey, resolved, params.title?.trim() || null);
    }

    if (imdbId) {
      const client = await db.connect();
      try {
        const resolvedTmdbId = await this.deps.externalIdResolver.resolve(client, {
          source: 'imdb_id',
          externalId: imdbId,
          mediaType: params.mediaFamily === 'anime' ? 'show' : params.mediaFamily,
        });
        if (!resolvedTmdbId) {
          cache.set(cacheKey, null);
          return null;
        }
        const resolvedMediaType = params.mediaFamily === 'anime' ? 'show' : params.mediaFamily;
        const resolved = buildResolvedImportIdentity(resolvedMediaType as 'movie' | 'show', {
          providerId: String(resolvedTmdbId),
          tmdbId: resolvedTmdbId,
          tvdbId: directTvdbId,
          kitsuId: directKitsuId,
        });
        return this.validate(cache, cacheKey, resolved, params.title?.trim() || null, client);
      } finally {
        client.release();
      }
    }

    const tvdbId = params.tvdbId?.trim();
    if (tvdbId && params.mediaFamily === 'show') {
      const client = await db.connect();
      try {
        const resolvedTmdbId = await this.deps.externalIdResolver.resolve(client, {
          source: 'tvdb_id',
          externalId: tvdbId,
          mediaType: 'show',
        });
        if (!resolvedTmdbId) {
          cache.set(cacheKey, null);
          return null;
        }
        const resolved = buildResolvedImportIdentity('show', {
          providerId: String(resolvedTmdbId),
          tmdbId: resolvedTmdbId,
          tvdbId: Number(tvdbId),
        });
        return this.validate(cache, cacheKey, resolved, params.title?.trim() || null, client);
      } finally {
        client.release();
      }
    }

    if (directKitsuId && params.mediaFamily === 'anime') {
      const resolved = buildResolvedImportIdentity('show', {
        providerId: directKitsuId,
        tmdbId: directTmdbId,
        kitsuId: directKitsuId,
      });
      return this.validate(cache, cacheKey, resolved, params.title?.trim() || null);
    }

    logger.warn({
      mediaFamily: params.mediaFamily,
      tmdbId: params.tmdbId ?? null,
      imdbId: params.imdbId?.trim() ?? null,
      tvdbId: params.tvdbId?.trim() ?? null,
      kitsuId: params.kitsuId ?? null,
      reason: 'no_resolvable_external_ids',
    }, 'trakt_import_resolve_failed');
    cache.set(cacheKey, null);
    return null;
  }

  private async validate(
    cache: Map<string, ResolvedImportIdentity | null>,
    cacheKey: string,
    resolved: ResolvedImportIdentity,
    sourceTitle?: string | null,
    existingClient?: DbClient,
  ): Promise<ResolvedImportIdentity | null> {
    const client = existingClient ?? (await db.connect());
    try {
      const cardView = await this.deps.metadataCardService.buildCardView(client, resolved.identity);
      if (sourceTitle && !titlesMatch(sourceTitle, cardView.title)) {
        logger.warn({
          mediaFamily: resolved.mediaType,
          tmdbId: resolved.identity.tmdbId,
          tvdbId: resolved.tvdbId,
          kitsuId: resolved.kitsuId,
          sourceTitle,
          resolvedTitle: cardView.title,
          reason: 'title_mismatch',
        }, 'trakt_import_resolve_rejected');
        cache.set(cacheKey, null);
        return null;
      }
      cache.set(cacheKey, resolved);
      return resolved;
    } catch {
      cache.set(cacheKey, null);
      return null;
    } finally {
      if (!existingClient) {
        client.release();
      }
    }
  }
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titlesMatch(sourceTitle: string, resolvedTitle: string | null): boolean {
  if (!resolvedTitle) return false;
  const a = normalizeTitle(sourceTitle);
  const b = normalizeTitle(resolvedTitle);
  if (!a || !b) return false;
  if (a === b) return true;
  return a.startsWith(b) || b.startsWith(a);
}

export function buildResolvedImportIdentity(
  mediaType: 'movie' | 'show',
  params: {
    providerId: string;
    tmdbId?: number | null;
    tvdbId?: number | null;
    kitsuId?: string | null;
  },
): ResolvedImportIdentity {
  const canonicalTmdbId = params.tmdbId ?? Number(params.providerId);
  const canonicalProviderId = canonicalTmdbId !== null && Number.isFinite(canonicalTmdbId)
    ? String(canonicalTmdbId)
    : params.providerId;
  const identity = inferMediaIdentity({
    mediaType,
    provider: 'tmdb',
    providerId: canonicalProviderId,
    tmdbId: canonicalTmdbId,
    providerMetadata: canonicalTmdbId
      ? {
          tmdbId: canonicalTmdbId,
          showTmdbId: mediaType === 'show' ? canonicalTmdbId : undefined,
        }
      : undefined,
  });
  return {
    identity,
    mediaType,
    tmdbId: identity.tmdbId,
    tvdbId: params.tvdbId ?? null,
    kitsuId: params.kitsuId ?? null,
  };
}

export type { MediaIdentity };
