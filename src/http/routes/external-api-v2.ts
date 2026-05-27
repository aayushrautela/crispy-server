import type { FastifyInstance } from 'fastify';
import { LocalUserWatchService } from '../../modules/integrations/local-user-watch.service.js';
import { HttpError } from '../../lib/errors.js';
import { success } from '../response.js';
import {
  externalApiV2HistoryRouteSchema,
  externalApiV2WatchlistRouteSchema,
  externalApiV2RatingsRouteSchema,
} from '../contracts/external-api-v2.js';
import type { BaseItemDto } from '../../modules/metadata/media-item.types.js';

function parseNullableString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

type MediaType = 'Movie' | 'Series' | 'Episode';

function narrowMediaType(type: string): MediaType {
  if (type === 'Episode') return 'Episode';
  if (type === 'Series') return 'Series';
  return 'Movie';
}

function mapHistoryItem(item: BaseItemDto): {
  tmdbId: number; mediaType: MediaType; title: string | null;
  seasonNumber?: number; episodeNumber?: number; seriesName?: string | null;
  watchedAt: string;
} | null {
  const tmdbId = Number(item.ProviderIds?.Tmdb ?? 0);
  if (!tmdbId) return null;
  return {
    tmdbId,
    mediaType: narrowMediaType(item.Type),
    title: item.Name ?? null,
    seasonNumber: item.ParentIndexNumber ?? undefined,
    episodeNumber: item.IndexNumber ?? undefined,
    seriesName: item.SeriesName ?? null,
    watchedAt: item.UserData?.LastPlayedDate ?? new Date(0).toISOString(),
  };
}

function mapWatchlistItem(item: BaseItemDto): {
  tmdbId: number; mediaType: 'Movie' | 'Series'; title: string | null;
  addedAt: string;
} | null {
  const tmdbId = Number(item.ProviderIds?.Tmdb ?? 0);
  if (!tmdbId) return null;
  return {
    tmdbId,
    mediaType: item.Type === 'Series' ? 'Series' : 'Movie',
    title: item.Name ?? null,
    addedAt: item.UserData?.LastPlayedDate ?? new Date(0).toISOString(),
  };
}

function mapRatingItem(item: BaseItemDto): {
  tmdbId: number; mediaType: MediaType; title: string | null;
  score: number; ratedAt: string;
} | null {
  const tmdbId = Number(item.ProviderIds?.Tmdb ?? 0);
  if (!tmdbId) return null;
  return {
    tmdbId,
    mediaType: narrowMediaType(item.Type),
    title: item.Name ?? null,
    score: item.UserData?.Rating ?? 0,
    ratedAt: item.UserData?.LastPlayedDate ?? new Date(0).toISOString(),
  };
}

export async function registerExternalApiV2Routes(app: FastifyInstance): Promise<void> {
  const watchService = new LocalUserWatchService();

  const preAuth = async (req: import('fastify').FastifyRequest) => app.requireExternalApiAuth(req);

  app.get('/v2/profiles/:profileId/watch/history', { schema: externalApiV2HistoryRouteSchema, preHandler: [preAuth] }, async (request) => {
    const actor = app.requireUserActor(request) as { appUserId: string; authSubject: string };
    const params = request.params as { profileId: string };
    const query = (request.query ?? {}) as { cursor?: string; limit?: string };
    const limit = Number(query.limit ?? 100);

    const page = await watchService.listHistoryPage({
      accountId: actor.authSubject,
      profileId: params.profileId,
      limit,
      cursor: parseNullableString(query.cursor),
    });

    const items = page.items.map(mapHistoryItem).filter((i): i is NonNullable<typeof i> => i !== null);

    return success({
      items,
      nextCursor: page.pageInfo.nextCursor,
      hasMore: page.pageInfo.hasMore,
    }, request);
  });

  app.get('/v2/profiles/:profileId/watch/watchlist', { schema: externalApiV2WatchlistRouteSchema, preHandler: [preAuth] }, async (request) => {
    const actor = app.requireUserActor(request) as { appUserId: string; authSubject: string };
    const params = request.params as { profileId: string };
    const query = (request.query ?? {}) as { cursor?: string; limit?: string };
    const limit = Number(query.limit ?? 50);

    const page = await watchService.listWatchlistPage({
      accountId: actor.authSubject,
      profileId: params.profileId,
      limit,
      cursor: parseNullableString(query.cursor),
    });

    const items = page.items.map(mapWatchlistItem).filter((i): i is NonNullable<typeof i> => i !== null);

    return success({
      items,
      nextCursor: page.pageInfo.nextCursor,
      hasMore: page.pageInfo.hasMore,
    }, request);
  });

  app.get('/v2/profiles/:profileId/watch/ratings', { schema: externalApiV2RatingsRouteSchema, preHandler: [preAuth] }, async (request) => {
    const actor = app.requireUserActor(request) as { appUserId: string; authSubject: string };
    const params = request.params as { profileId: string };
    const query = (request.query ?? {}) as { cursor?: string; limit?: string };
    const limit = Number(query.limit ?? 50);

    const page = await watchService.listRatingsPage({
      accountId: actor.authSubject,
      profileId: params.profileId,
      limit,
      cursor: parseNullableString(query.cursor),
    });

    const items = page.items.map(mapRatingItem).filter((i): i is NonNullable<typeof i> => i !== null);

    return success({
      items,
      nextCursor: page.pageInfo.nextCursor,
      hasMore: page.pageInfo.hasMore,
    }, request);
  });
}
