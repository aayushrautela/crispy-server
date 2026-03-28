import type { FastifyInstance } from 'fastify';
import {
  watchContinueWatchingDismissRouteSchema,
  watchEventsRouteSchema,
  watchListRouteSchema,
  watchMediaKeyMutationRouteSchema,
  watchMediaKeyParamsRouteSchema,
  watchMutationRouteSchema,
  watchStateRouteSchema,
  watchStatesRouteSchema,
  type WatchContinueWatchingDismissParams,
  type WatchEventBody,
  type WatchMediaKeyParams,
  type WatchMutationBody,
  type WatchPaginationQuery,
  type WatchProfileParams,
  type WatchStateBatchBody,
  type WatchStateLookupContract,
} from '../contracts/watch.js';
import { ContinueWatchingService } from '../../modules/watch/continue-watching.service.js';
import { WatchEventIngestService } from '../../modules/watch/event-ingest.service.js';
import { WatchHistoryQueryService } from '../../modules/watch/history.service.js';
import { WatchCollectionService } from '../../modules/watch/watch-collection.service.js';
import { WatchStateService } from '../../modules/watch/watch-state.service.js';
import { nowIso } from '../../lib/time.js';
import type { WatchStateLookupInput } from '../../modules/watch/watch-read.types.js';
import { ensureSupportedProvider } from '../../modules/watch/media-key.js';

export async function registerWatchRoutes(app: FastifyInstance): Promise<void> {
  const ingestService = new WatchEventIngestService();
  const continueWatchingService = new ContinueWatchingService();
  const historyService = new WatchHistoryQueryService();
  const watchCollectionService = new WatchCollectionService();
  const watchStateService = new WatchStateService();

  app.post('/v1/profiles/:profileId/watch/events', { schema: watchEventsRouteSchema }, async (request, reply) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const profileId = getProfileIdFromParams(request.params);
    const body = (request.body ?? {}) as WatchEventBody;
    const result = await ingestService.ingestPlaybackEvent(actor.appUserId, profileId, {
      clientEventId: String(body.clientEventId ?? ''),
      eventType: String(body.eventType ?? ''),
      mediaKey: typeof body.mediaKey === 'string' ? body.mediaKey : undefined,
      mediaType: String(body.mediaType ?? ''),
      provider: parseOptionalProvider(body.provider),
      providerId: parseOptionalString(body.providerId),
      parentProvider: parseOptionalProvider(body.parentProvider),
      parentProviderId: parseOptionalString(body.parentProviderId),
      seasonNumber: parseNullableNumber(body.seasonNumber),
      episodeNumber: parseNullableNumber(body.episodeNumber),
      absoluteEpisodeNumber: parseNullableNumber(body.absoluteEpisodeNumber),
      positionSeconds: typeof body.positionSeconds === 'number' ? body.positionSeconds : null,
      durationSeconds: typeof body.durationSeconds === 'number' ? body.durationSeconds : null,
      rating: typeof body.rating === 'number' ? body.rating : null,
      occurredAt: typeof body.occurredAt === 'string' ? body.occurredAt : null,
      payload: typeof body.payload === 'object' && body.payload !== null ? (body.payload as Record<string, unknown>) : {},
    });
    if (result.mode === 'buffered') {
      return reply.code(202).send(result);
    }
    return result;
  });

  app.get('/v1/profiles/:profileId/watch/continue-watching', { schema: watchListRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const profileId = getProfileIdFromParams(request.params);
    const query = (request.query ?? {}) as WatchPaginationQuery;
    const limit = Number(query.limit ?? 20);
    const generatedAt = nowIso();
    return {
      profileId,
      kind: 'continue-watching' as const,
      source: 'canonical_watch' as const,
      generatedAt,
      items: await continueWatchingService.list(actor.appUserId, profileId, limit),
    };
  });

  app.delete('/v1/profiles/:profileId/watch/continue-watching/:id', { schema: watchContinueWatchingDismissRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const params = request.params as Partial<WatchContinueWatchingDismissParams> & { id: string };
    const profileId = getProfileIdFromParams(params);
    return ingestService.dismissContinueWatching(actor.appUserId, profileId, params.id);
  });

  app.get('/v1/profiles/:profileId/watch/history', { schema: watchListRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const profileId = getProfileIdFromParams(request.params);
    const query = (request.query ?? {}) as WatchPaginationQuery;
    const limit = Number(query.limit ?? 50);
    const generatedAt = nowIso();
    return {
      profileId,
      kind: 'history' as const,
      source: 'canonical_watch' as const,
      generatedAt,
      items: await historyService.list(actor.appUserId, profileId, limit),
    };
  });

  app.get('/v1/profiles/:profileId/watch/watchlist', { schema: watchListRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const profileId = getProfileIdFromParams(request.params);
    const query = (request.query ?? {}) as WatchPaginationQuery;
    const limit = Number(query.limit ?? 50);
    const generatedAt = nowIso();
    return {
      profileId,
      kind: 'watchlist' as const,
      source: 'canonical_watch' as const,
      generatedAt,
      items: await watchCollectionService.listWatchlist(actor.appUserId, profileId, limit),
    };
  });

  app.get('/v1/profiles/:profileId/watch/ratings', { schema: watchListRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const profileId = getProfileIdFromParams(request.params);
    const query = (request.query ?? {}) as WatchPaginationQuery;
    const limit = Number(query.limit ?? 50);
    const generatedAt = nowIso();
    return {
      profileId,
      kind: 'ratings' as const,
      source: 'canonical_watch' as const,
      generatedAt,
      items: await watchCollectionService.listRatings(actor.appUserId, profileId, limit),
    };
  });

  app.get('/v1/profiles/:profileId/watch/state', { schema: watchStateRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const profileId = getProfileIdFromParams(request.params);
    const query = (request.query ?? {}) as WatchStateLookupContract;
    return {
      profileId,
      source: 'canonical_watch' as const,
      generatedAt: nowIso(),
      item: await watchStateService.getState(actor.appUserId, profileId, mapStateLookupInput(query)),
    };
  });

  app.post('/v1/profiles/:profileId/watch/states', { schema: watchStatesRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const profileId = getProfileIdFromParams(request.params);
    const body = (request.body ?? {}) as WatchStateBatchBody;
    const items = Array.isArray(body.items) ? body.items : [];

    return {
      profileId,
      source: 'canonical_watch' as const,
      generatedAt: nowIso(),
      items: await watchStateService.getStates(
        actor.appUserId,
        profileId,
        items.map((item) => mapStateLookupInput((item ?? {}) as WatchStateLookupContract)),
      ),
    };
  });

  app.post('/v1/profiles/:profileId/watch/mark-watched', { schema: watchMutationRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const profileId = getProfileIdFromParams(request.params);
    const body = (request.body ?? {}) as WatchMutationBody;
    return ingestService.markWatched(actor.appUserId, profileId, mapMutationBody(body));
  });

  app.post('/v1/profiles/:profileId/watch/unmark-watched', { schema: watchMutationRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const profileId = getProfileIdFromParams(request.params);
    const body = (request.body ?? {}) as WatchMutationBody;
    return ingestService.unmarkWatched(actor.appUserId, profileId, mapMutationBody(body));
  });

  app.put('/v1/profiles/:profileId/watch/watchlist/:mediaKey', { schema: watchMediaKeyMutationRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const params = request.params as Partial<WatchMediaKeyParams> & { mediaKey: string };
    const profileId = getProfileIdFromParams(params);
    const body = (request.body ?? {}) as WatchMutationBody;
    return ingestService.setWatchlist(actor.appUserId, profileId, {
      ...mapMutationBody(body),
      mediaKey: params.mediaKey,
    });
  });

  app.delete('/v1/profiles/:profileId/watch/watchlist/:mediaKey', { schema: watchMediaKeyParamsRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const params = request.params as Partial<WatchMediaKeyParams> & { mediaKey: string };
    const profileId = getProfileIdFromParams(params);
    return ingestService.removeWatchlist(actor.appUserId, profileId, params.mediaKey);
  });

  app.put('/v1/profiles/:profileId/watch/rating/:mediaKey', { schema: watchMediaKeyMutationRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const params = request.params as Partial<WatchMediaKeyParams> & { mediaKey: string };
    const profileId = getProfileIdFromParams(params);
    const body = (request.body ?? {}) as WatchMutationBody;
    return ingestService.setRating(actor.appUserId, profileId, {
      ...mapMutationBody(body),
      mediaKey: params.mediaKey,
      rating: typeof body.rating === 'number' ? body.rating : null,
    });
  });

  app.delete('/v1/profiles/:profileId/watch/rating/:mediaKey', { schema: watchMediaKeyParamsRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const params = request.params as Partial<WatchMediaKeyParams> & { mediaKey: string };
    const profileId = getProfileIdFromParams(params);
    return ingestService.removeRating(actor.appUserId, profileId, params.mediaKey);
  });
}

function getProfileIdFromParams(params: unknown): string {
  const profileId = typeof (params as { profileId?: unknown } | null)?.profileId === 'string'
    ? (params as { profileId: string }).profileId.trim()
    : '';
  if (!profileId) {
    throw new Error('Profile route is missing profileId param.');
  }
  return profileId;
}

function mapMutationBody(body: WatchMutationBody) {
  return {
    mediaKey: typeof body.mediaKey === 'string' ? body.mediaKey : undefined,
    mediaType: String(body.mediaType ?? ''),
    provider: parseOptionalProvider(body.provider),
    providerId: parseOptionalString(body.providerId),
    parentProvider: parseOptionalProvider(body.parentProvider),
    parentProviderId: parseOptionalString(body.parentProviderId),
    seasonNumber: parseNullableNumber(body.seasonNumber),
    episodeNumber: parseNullableNumber(body.episodeNumber),
    absoluteEpisodeNumber: parseNullableNumber(body.absoluteEpisodeNumber),
    occurredAt: typeof body.occurredAt === 'string' ? body.occurredAt : null,
    rating: typeof body.rating === 'number' ? body.rating : null,
    payload: typeof body.payload === 'object' && body.payload !== null ? (body.payload as Record<string, unknown>) : {},
  };
}

function parseOptionalNumber(value: unknown): number | null | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function parseNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = parseOptionalNumber(value);
  return typeof parsed === 'number' ? parsed : null;
}

function mapStateLookupInput(query: WatchStateLookupContract): WatchStateLookupInput {
  return {
    mediaKey: typeof query.mediaKey === 'string' ? query.mediaKey : undefined,
    mediaType: typeof query.mediaType === 'string' ? query.mediaType : undefined,
    provider: parseOptionalProvider(query.provider),
    providerId: parseOptionalString(query.providerId),
    parentProvider: parseOptionalProvider(query.parentProvider),
    parentProviderId: parseOptionalString(query.parentProviderId),
    seasonNumber: parseOptionalNumber(query.seasonNumber),
    episodeNumber: parseOptionalNumber(query.episodeNumber),
    absoluteEpisodeNumber: parseOptionalNumber(query.absoluteEpisodeNumber),
  };
}

function parseOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseNullableString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return parseOptionalString(value);
}

function parseOptionalProvider(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  return ensureSupportedProvider(value.trim());
}
