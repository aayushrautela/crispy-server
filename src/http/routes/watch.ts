import type { FastifyInstance } from 'fastify';
import { ContinueWatchingService } from '../../modules/watch/continue-watching.service.js';
import { WatchEventIngestService } from '../../modules/watch/event-ingest.service.js';
import { WatchHistoryQueryService } from '../../modules/watch/history.service.js';
import { WatchCollectionService } from '../../modules/watch/watch-collection.service.js';
import { WatchStateService } from '../../modules/watch/watch-state.service.js';
import type { WatchStateLookupInput } from '../../modules/watch/watch-read.types.js';

export async function registerWatchRoutes(app: FastifyInstance): Promise<void> {
  const ingestService = new WatchEventIngestService();
  const continueWatchingService = new ContinueWatchingService();
  const historyService = new WatchHistoryQueryService();
  const watchCollectionService = new WatchCollectionService();
  const watchStateService = new WatchStateService();

  app.post('/v1/profiles/:profileId/watch/events', async (request, reply) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const profileId = getProfileIdFromParams(request.params);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const result = await ingestService.ingestPlaybackEvent(actor.appUserId, profileId, {
      clientEventId: String(body.clientEventId ?? ''),
      eventType: String(body.eventType ?? ''),
      mediaKey: typeof body.mediaKey === 'string' ? body.mediaKey : undefined,
      mediaType: String(body.mediaType ?? ''),
      tmdbId: typeof body.tmdbId === 'number' ? body.tmdbId : null,
      showTmdbId: typeof body.showTmdbId === 'number' ? body.showTmdbId : null,
      seasonNumber: typeof body.seasonNumber === 'number' ? body.seasonNumber : null,
      episodeNumber: typeof body.episodeNumber === 'number' ? body.episodeNumber : null,
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

  app.get('/v1/profiles/:profileId/watch/continue-watching', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const profileId = getProfileIdFromParams(request.params);
    const limit = Number((request.query as { limit?: string }).limit ?? 20);
    return {
      items: await continueWatchingService.list(actor.appUserId, profileId, limit),
    };
  });

  app.delete('/v1/profiles/:profileId/watch/continue-watching/:id', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const params = request.params as { profileId?: string; id: string };
    const profileId = getProfileIdFromParams(params);
    return ingestService.dismissContinueWatching(actor.appUserId, profileId, params.id);
  });

  app.get('/v1/profiles/:profileId/watch/history', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const profileId = getProfileIdFromParams(request.params);
    const limit = Number((request.query as { limit?: string }).limit ?? 50);
    return {
      items: await historyService.list(actor.appUserId, profileId, limit),
    };
  });

  app.get('/v1/profiles/:profileId/watch/watchlist', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const profileId = getProfileIdFromParams(request.params);
    const limit = Number((request.query as { limit?: string }).limit ?? 50);
    return {
      items: await watchCollectionService.listWatchlist(actor.appUserId, profileId, limit),
    };
  });

  app.get('/v1/profiles/:profileId/watch/ratings', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const profileId = getProfileIdFromParams(request.params);
    const limit = Number((request.query as { limit?: string }).limit ?? 50);
    return {
      items: await watchCollectionService.listRatings(actor.appUserId, profileId, limit),
    };
  });

  app.get('/v1/profiles/:profileId/watch/state', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const profileId = getProfileIdFromParams(request.params);
    const query = request.query as Record<string, unknown>;
    return watchStateService.getState(actor.appUserId, profileId, mapStateLookupInput(query));
  });

  app.post('/v1/profiles/:profileId/watch/states', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const profileId = getProfileIdFromParams(request.params);
    const body = (request.body ?? {}) as { items?: unknown };
    const items = Array.isArray(body.items) ? body.items : [];

    return {
      items: await watchStateService.getStates(
        actor.appUserId,
        profileId,
        items.map((item) => mapStateLookupInput((item ?? {}) as Record<string, unknown>)),
      ),
    };
  });

  app.post('/v1/profiles/:profileId/watch/mark-watched', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const profileId = getProfileIdFromParams(request.params);
    const body = (request.body ?? {}) as Record<string, unknown>;
    return ingestService.markWatched(actor.appUserId, profileId, mapMutationBody(body));
  });

  app.post('/v1/profiles/:profileId/watch/unmark-watched', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const profileId = getProfileIdFromParams(request.params);
    const body = (request.body ?? {}) as Record<string, unknown>;
    return ingestService.unmarkWatched(actor.appUserId, profileId, mapMutationBody(body));
  });

  app.put('/v1/profiles/:profileId/watch/watchlist/:mediaKey', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const params = request.params as { profileId?: string; mediaKey: string };
    const profileId = getProfileIdFromParams(params);
    const body = (request.body ?? {}) as Record<string, unknown>;
    return ingestService.setWatchlist(actor.appUserId, profileId, {
      ...mapMutationBody(body),
      mediaKey: params.mediaKey,
    });
  });

  app.delete('/v1/profiles/:profileId/watch/watchlist/:mediaKey', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const params = request.params as { profileId?: string; mediaKey: string };
    const profileId = getProfileIdFromParams(params);
    return ingestService.removeWatchlist(actor.appUserId, profileId, params.mediaKey);
  });

  app.put('/v1/profiles/:profileId/watch/rating/:mediaKey', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const params = request.params as { profileId?: string; mediaKey: string };
    const profileId = getProfileIdFromParams(params);
    const body = (request.body ?? {}) as Record<string, unknown>;
    return ingestService.setRating(actor.appUserId, profileId, {
      ...mapMutationBody(body),
      mediaKey: params.mediaKey,
      rating: typeof body.rating === 'number' ? body.rating : null,
    });
  });

  app.delete('/v1/profiles/:profileId/watch/rating/:mediaKey', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const params = request.params as { profileId?: string; mediaKey: string };
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

function mapMutationBody(body: Record<string, unknown>) {
  return {
    mediaKey: typeof body.mediaKey === 'string' ? body.mediaKey : undefined,
    mediaType: String(body.mediaType ?? ''),
    tmdbId: typeof body.tmdbId === 'number' ? body.tmdbId : null,
    showTmdbId: typeof body.showTmdbId === 'number' ? body.showTmdbId : null,
    seasonNumber: typeof body.seasonNumber === 'number' ? body.seasonNumber : null,
    episodeNumber: typeof body.episodeNumber === 'number' ? body.episodeNumber : null,
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

function mapStateLookupInput(query: Record<string, unknown>): WatchStateLookupInput {
  return {
    mediaKey: typeof query.mediaKey === 'string' ? query.mediaKey : undefined,
    mediaType: typeof query.mediaType === 'string' ? query.mediaType : undefined,
    tmdbId: parseOptionalNumber(query.tmdbId),
    showTmdbId: parseOptionalNumber(query.showTmdbId),
    seasonNumber: parseOptionalNumber(query.seasonNumber),
    episodeNumber: parseOptionalNumber(query.episodeNumber),
  };
}
