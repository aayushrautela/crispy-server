import type { FastifyInstance } from 'fastify';
import {
  continueWatchingListRouteSchema,
  historyListRouteSchema,
  ratingsListRouteSchema,
  watchContinueWatchingDismissRouteSchema,
  watchEventsRouteSchema,
  watchItemIdMutationRouteSchema,
  watchItemIdParamsRouteSchema,
  watchMutationRouteSchema,
  watchStateRouteSchema,
  watchStatesRouteSchema,
  watchStreamRouteSchema,
  watchlistListRouteSchema,
  type WatchContinueWatchingDismissParams,
  type WatchEventBody,
  type WatchMutationBody,
  type WatchPaginationQuery,
  type WatchStateBatchBody,
  type WatchStateLookupContract,
} from '../contracts/watch.js';
import { LocalUserWatchService } from '../../modules/integrations/local-user-watch.service.js';
import { EpisodicFollowService } from '../../modules/watch/episodic-follow.service.js';
import { getPlaybackProgressBuffer } from '../../modules/watch/playback-progress-buffer.service.js';
import { HttpError } from '../../lib/errors.js';
import { withDbClient } from '../../lib/db.js';
import { WatchCardHydrator } from '../../modules/watch/watch-card-hydrator.service.js';
import { MetadataLanguageService } from '../../modules/metadata/metadata-language.service.js';
import { mutation, success } from '../response.js';
import { assertPublicItemId, decodePublicItemId, encodePublicItemId } from '../../modules/identity/public-item-id.js';
import { ContentIdentityService } from '../../modules/identity/content-identity.service.js';
import { ContentIdentityRepository } from '../../modules/identity/content-identity.repo.js';
import { requireProfileUnlock } from '../plugins/profile-unlock-guard.js';
import { redis } from '../../lib/redis.js';

export interface WatchRoutesDeps {
  profilePinService?: {
    hasPin(profileId: string): Promise<boolean>;
  };
}

const MAX_WATCH_STREAMS_PER_PROFILE = 5;
const activeWatchStreams = new Map<string, number>();

function acquireWatchStream(streamKey: string): boolean {
  const current = activeWatchStreams.get(streamKey) ?? 0;
  if (current >= MAX_WATCH_STREAMS_PER_PROFILE) {
    return false;
  }
  activeWatchStreams.set(streamKey, current + 1);
  return true;
}

function releaseWatchStream(streamKey: string): void {
  const current = activeWatchStreams.get(streamKey) ?? 0;
  if (current <= 1) {
    activeWatchStreams.delete(streamKey);
  } else {
    activeWatchStreams.set(streamKey, current - 1);
  }
}

export async function registerWatchRoutes(
  app: FastifyInstance,
  deps: WatchRoutesDeps = {}
): Promise<void> {
  const localUserWatchService = new LocalUserWatchService();
  const watchCardHydrator = new WatchCardHydrator();
  const metadataLanguageService = new MetadataLanguageService();
  const contentIdentityService = new ContentIdentityService();
  const contentIdentityRepo = new ContentIdentityRepository();
  const episodicFollowService = new EpisodicFollowService();
  const { profilePinService } = deps;

  async function assertProfileUnlocked(request: import('fastify').FastifyRequest, profileId: string) {
    if (!profilePinService) return;
    await requireProfileUnlock(request, profileId, { profilePinService });
  }

  app.post('/v1/profiles/:profileId/watch/events', { schema: watchEventsRouteSchema }, async (request, reply) => {
    await app.requireAuth(request);
    const actor = app.requireUserSessionActor(request);
    const profileId = getProfileIdFromParams(request.params);
    await assertProfileUnlocked(request, profileId);
    const body = (request.body ?? {}) as WatchEventBody;
    const playableItemId = assertPublicItemId(body.itemId!);
    const resolved = await withDbClient(async (client) => {
      const { publicTitleItemId, mediaType } = await contentIdentityService.resolveTitleItemIdForPlayableItemId(client, body.itemId!);
      return { titleItemId: decodePublicItemId(publicTitleItemId), mediaType: toPlayableMediaType(mediaType) };
    });
    const seasonNumber = typeof body.seasonNumber === 'number' ? Math.trunc(body.seasonNumber) : null;
    const episodeNumber = typeof body.episodeNumber === 'number' ? Math.trunc(body.episodeNumber) : null;
    let effectiveItemId = playableItemId;
    let effectiveMediaType = resolved.mediaType;
    if (effectiveMediaType === 'show' && seasonNumber != null && episodeNumber != null) {
      const episodeContentId = await localUserWatchService.resolveEpisodePlayableItemId(resolved.titleItemId, seasonNumber, episodeNumber);
      if (episodeContentId) {
        effectiveItemId = encodePublicItemId(episodeContentId);
        effectiveMediaType = 'episode';
      }
    }
    await getPlaybackProgressBuffer(localUserWatchService).bufferProgress({
      accountId: actor.authSubject!,
      profileId,
      itemId: effectiveItemId,
      titleItemId: resolved.titleItemId,
      mediaType: effectiveMediaType,
      positionSeconds: typeof body.positionSeconds === 'number' ? body.positionSeconds : null,
      durationSeconds: typeof body.durationSeconds === 'number' ? body.durationSeconds : null,
      progressBps: null,
      seasonNumber,
      episodeNumber,
      eventKind: String(body.eventType ?? '') === 'playback_completed' ? 'playback_completed' : 'playback_progress',
      lastActivityAt: typeof body.occurredAt === 'string' ? body.occurredAt : new Date().toISOString(),
    });
    return mutation({ accepted: true, mode: 'synchronous' as const });
  });

  app.get('/v1/profiles/:profileId/watch/continue-watching', { schema: continueWatchingListRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserSessionActor(request);
    const profileId = getProfileIdFromParams(request.params);
    await assertProfileUnlocked(request, profileId);
    const query = (request.query ?? {}) as WatchPaginationQuery;
    const limit = Number(query.limit ?? 20);
    const language = await metadataLanguageService.resolveForProfile(profileId, actor.appUserId);
    const page = await localUserWatchService.listContinueWatchingPage({
      accountId: actor.authSubject!,
      profileId,
      limit,
      cursor: parseNullableString(query.cursor),
    });
    const enrichedItems = page.items.length
      ? await withDbClient((client) =>
        watchCardHydrator.hydrateItems(client, page.items, language, query.extended === 'true'),
      )
      : page.items;
    return success({
      Items: enrichedItems,
      StartIndex: 0,
      TotalRecordCount: enrichedItems.length,
      NextCursor: page.pageInfo.nextCursor,
      HasMore: page.pageInfo.hasMore,
    });
  });

  app.get('/v1/profiles/:profileId/watch/episodic-follow', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserSessionActor(request);
    const profileId = getProfileIdFromParams(request.params);
    await assertProfileUnlocked(request, profileId);
    const query = (request.query ?? {}) as WatchPaginationQuery;
    const limit = Number(query.limit ?? 20);
    const generatedAt = new Date().toISOString();
    const items = await withDbClient(async (client) =>
      episodicFollowService.listForProfile(client, profileId, limit),
    );
    return success({
      profileId,
      kind: 'episodic-follow' as const,
      source: 'canonical_watch' as const,
      generatedAt,
      items,
      pageInfo: { hasMore: false, nextCursor: null },
    });
  });

  app.delete('/v1/profiles/:profileId/watch/continue-watching/:id', { schema: watchContinueWatchingDismissRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserSessionActor(request);
    const params = request.params as Partial<WatchContinueWatchingDismissParams> & { id: string };
    const profileId = getProfileIdFromParams(params);
    await assertProfileUnlocked(request, profileId);
    const playableItemId = assertPublicItemId(params.id);
    const resolved = await withDbClient(async (client) => {
      const { publicTitleItemId } = await contentIdentityService.resolveTitleItemIdForPlayableItemId(client, params.id!);
      return { titleItemId: decodePublicItemId(publicTitleItemId) };
    });
    await localUserWatchService.dismissContinueWatching({
      accountId: actor.authSubject!,
      profileId,
      titleItemId: resolved.titleItemId,
      playableItemId,
    });
    return mutation({ accepted: true, mode: 'synchronous' as const });
  });

  app.get('/v1/profiles/:profileId/watch/history', { schema: historyListRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserSessionActor(request);
    const profileId = getProfileIdFromParams(request.params);
    await assertProfileUnlocked(request, profileId);
    const query = (request.query ?? {}) as WatchPaginationQuery;
    const limit = Number(query.limit ?? 100);
    const language = await metadataLanguageService.resolveForProfile(profileId, actor.appUserId);
    const page = await localUserWatchService.listHistoryPage({
      accountId: actor.authSubject!,
      profileId,
      limit,
      cursor: parseNullableString(query.cursor),
      itemId: parseNullableString(query.itemId),
    });
    const enrichedItems = page.items.length
      ? await withDbClient((client) =>
        watchCardHydrator.hydrateItems(client, page.items, language, query.extended === 'true'),
      )
      : page.items;
    return success({
      Items: enrichedItems,
      StartIndex: 0,
      TotalRecordCount: enrichedItems.length,
      NextCursor: page.pageInfo.nextCursor,
      HasMore: page.pageInfo.hasMore,
    });
  });

  app.get('/v1/profiles/:profileId/watch/watchlist', { schema: watchlistListRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserSessionActor(request);
    const profileId = getProfileIdFromParams(request.params);
    await assertProfileUnlocked(request, profileId);
    const query = (request.query ?? {}) as WatchPaginationQuery;
    const limit = Number(query.limit ?? 50);
    const language = await metadataLanguageService.resolveForProfile(profileId, actor.appUserId);
    const page = await localUserWatchService.listWatchlistPage({
      accountId: actor.authSubject!,
      profileId,
      limit,
      cursor: parseNullableString(query.cursor),
    });
    const enrichedItems = page.items.length
      ? await withDbClient((client) =>
        watchCardHydrator.hydrateItems(client, page.items, language, query.extended === 'true'),
      )
      : page.items;
    return success({
      Items: enrichedItems,
      StartIndex: 0,
      TotalRecordCount: enrichedItems.length,
      NextCursor: page.pageInfo.nextCursor,
      HasMore: page.pageInfo.hasMore,
    });
  });

  app.get('/v1/profiles/:profileId/watch/ratings', { schema: ratingsListRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserSessionActor(request);
    const profileId = getProfileIdFromParams(request.params);
    await assertProfileUnlocked(request, profileId);
    const query = (request.query ?? {}) as WatchPaginationQuery;
    const limit = Number(query.limit ?? 50);
    const language = await metadataLanguageService.resolveForProfile(profileId, actor.appUserId);
    const page = await localUserWatchService.listRatingsPage({
      accountId: actor.authSubject!,
      profileId,
      limit,
      cursor: parseNullableString(query.cursor),
    });
    const enrichedItems = page.items.length
      ? await withDbClient((client) =>
        watchCardHydrator.hydrateItems(client, page.items, language, query.extended === 'true'),
      )
      : page.items;
    return success({
      Items: enrichedItems,
      StartIndex: 0,
      TotalRecordCount: enrichedItems.length,
      NextCursor: page.pageInfo.nextCursor,
      HasMore: page.pageInfo.hasMore,
    });
  });

  app.get('/v1/profiles/:profileId/watch/state', { schema: watchStateRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserSessionActor(request);
    const profileId = getProfileIdFromParams(request.params);
    await assertProfileUnlocked(request, profileId);
    const query = (request.query ?? {}) as WatchStateLookupContract;
    const language = await metadataLanguageService.resolveForProfile(profileId, actor.appUserId);
    const itemId = assertPublicItemId(query.itemId!);
    const item = await localUserWatchService.getState({
      accountId: actor.authSubject!,
      profileId,
      itemIds: [itemId],
    });
    const enrichedItem = await withDbClient((client) =>
      watchCardHydrator.hydrateItems(client, [item], language, query.extended === 'true'),
    );
    return success(enrichedItem[0]);
  });

  app.post('/v1/profiles/:profileId/watch/states', { schema: watchStatesRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserSessionActor(request);
    const profileId = getProfileIdFromParams(request.params);
    await assertProfileUnlocked(request, profileId);
    const body = (request.body ?? {}) as WatchStateBatchBody;
    const items = Array.isArray(body.items) ? body.items : [];

    const language = await metadataLanguageService.resolveForProfile(profileId, actor.appUserId);
    const itemIds = items.map((item) => assertPublicItemId(item.itemId!));
    const stateItems = await localUserWatchService.getStates({
      accountId: actor.authSubject!,
      profileId,
      itemIds,
    });
    const enrichedItems = await withDbClient((client) =>
      watchCardHydrator.hydrateItems(client, stateItems, language, true),
    );
    return success({ items: enrichedItems });
  });

  app.post('/v1/profiles/:profileId/watch/mark-watched', { schema: watchMutationRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserSessionActor(request);
    const profileId = getProfileIdFromParams(request.params);
    await assertProfileUnlocked(request, profileId);
    const body = (request.body ?? {}) as WatchMutationBody;
    const playableItemId = assertPublicItemId(body.itemId!);
    const resolved = await withDbClient(async (client) => {
      const { publicTitleItemId, mediaType } = await contentIdentityService.resolveTitleItemIdForPlayableItemId(client, body.itemId!);
      return { titleItemId: decodePublicItemId(publicTitleItemId), mediaType: toPlayableMediaType(mediaType) };
    });
    let effectiveItemId = playableItemId;
    let effectiveMediaType = resolved.mediaType;
    if (effectiveMediaType === 'show' && Number.isInteger(body.seasonNumber) && Number.isInteger(body.episodeNumber)) {
      const episodeContentId = await localUserWatchService.resolveEpisodePlayableItemId(resolved.titleItemId, body.seasonNumber as number, body.episodeNumber as number);
      if (episodeContentId) {
        effectiveItemId = encodePublicItemId(episodeContentId);
        effectiveMediaType = 'episode';
      }
    }
    await localUserWatchService.markWatched({
      accountId: actor.authSubject!,
      profileId,
      itemId: effectiveItemId,
      titleItemId: resolved.titleItemId,
      mediaType: effectiveMediaType,
      occurredAt: typeof body.occurredAt === 'string' ? body.occurredAt : undefined,
    });
    return mutation({ accepted: true, mode: 'synchronous' as const });
  });

  app.post('/v1/profiles/:profileId/watch/unmark-watched', { schema: watchMutationRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserSessionActor(request);
    const profileId = getProfileIdFromParams(request.params);
    await assertProfileUnlocked(request, profileId);
    const body = (request.body ?? {}) as WatchMutationBody;
    const playableItemId = assertPublicItemId(body.itemId!);
    const resolved = await withDbClient(async (client) => {
      const { publicTitleItemId, mediaType } = await contentIdentityService.resolveTitleItemIdForPlayableItemId(client, body.itemId!);
      return { titleItemId: decodePublicItemId(publicTitleItemId), mediaType: toPlayableMediaType(mediaType) };
    });
    await localUserWatchService.unmarkWatched({
      accountId: actor.authSubject!,
      profileId,
      itemId: playableItemId,
      titleItemId: resolved.titleItemId,
      mediaType: resolved.mediaType,
      occurredAt: typeof body.occurredAt === 'string' ? body.occurredAt : undefined,
    });
    return mutation({ accepted: true, mode: 'synchronous' as const });
  });

  app.put('/v1/profiles/:profileId/watch/watchlist/:itemId', { schema: watchItemIdMutationRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserSessionActor(request);
    const params = request.params as { profileId: string; itemId: string };
    const profileId = getProfileIdFromParams(params);
    await assertProfileUnlocked(request, profileId);
    const itemId = assertPublicItemId(params.itemId);
    const resolvedMediaType = await withDbClient(async (client) => {
      const contentItem = await contentIdentityRepo.findContentItemById(client, itemId);
      return toPlayableMediaType(contentItem?.entityType ?? 'movie');
    });
    await localUserWatchService.setListItem({
      accountId: actor.authSubject!,
      profileId,
      listKind: 'watchlist',
      itemId,
      mediaType: resolvedMediaType,
    });
    return mutation({ accepted: true, mode: 'synchronous' as const });
  });

  app.delete('/v1/profiles/:profileId/watch/watchlist/:itemId', { schema: watchItemIdParamsRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserSessionActor(request);
    const params = request.params as { profileId: string; itemId: string };
    const profileId = getProfileIdFromParams(params);
    await assertProfileUnlocked(request, profileId);
    const itemId = assertPublicItemId(params.itemId);
    await localUserWatchService.deleteListItem({
      accountId: actor.authSubject!,
      profileId,
      listKind: 'watchlist',
      itemId,
    });
    return mutation({ accepted: true, mode: 'synchronous' as const });
  });

  app.put('/v1/profiles/:profileId/watch/rating/:itemId', { schema: watchItemIdMutationRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserSessionActor(request);
    const params = request.params as { profileId: string; itemId: string };
    const profileId = getProfileIdFromParams(params);
    await assertProfileUnlocked(request, profileId);
    const body = (request.body ?? {}) as WatchMutationBody;
    if (typeof body.rating !== 'number') {
      throw new HttpError(400, 'Rating must be between 1 and 10.');
    }
    const itemId = assertPublicItemId(params.itemId);
    const resolvedMediaType = await withDbClient(async (client) => {
      const contentItem = await contentIdentityRepo.findContentItemById(client, itemId);
      return toPlayableMediaType(contentItem?.entityType ?? 'movie');
    });
    await localUserWatchService.setRating({
      accountId: actor.authSubject!,
      profileId,
      itemId,
      mediaType: resolvedMediaType,
      rating: body.rating,
    });
    return mutation({ accepted: true, mode: 'synchronous' as const });
  });

  app.delete('/v1/profiles/:profileId/watch/rating/:itemId', { schema: watchItemIdParamsRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserSessionActor(request);
    const params = request.params as { profileId: string; itemId: string };
    const profileId = getProfileIdFromParams(params);
    await assertProfileUnlocked(request, profileId);
    const itemId = assertPublicItemId(params.itemId);
    await localUserWatchService.deleteRating({
      accountId: actor.authSubject!,
      profileId,
      itemId,
    });
    return mutation({ accepted: true, mode: 'synchronous' as const });
  });

  app.get('/v1/profiles/:profileId/watch/stream', { schema: watchStreamRouteSchema }, async (request, reply) => {
    await app.requireAuth(request);
    const actor = app.requireUserSessionActor(request);
    const profileId = getProfileIdFromParams(request.params);
    await assertProfileUnlocked(request, profileId);
    const accountId = actor.authSubject!;
    const streamKey = `${accountId}:${profileId}`;

    if (!acquireWatchStream(streamKey)) {
      return reply.code(429).send({ error: 'too_many_connections', retry_after_ms: 1000 });
    }

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    raw.write('retry: 3000\n\n');

    const channel = `cw:${accountId}`;
    const subscriber = redis.duplicate();
    let closed = false;

    const heartbeat = setInterval(() => {
      if (closed) return;
      raw.write(': ping\n\n');
    }, 30000);

    const finish = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      subscriber.unsubscribe(channel).catch(() => {});
      subscriber.quit().catch(() => {});
      releaseWatchStream(streamKey);
    };

    await subscriber.subscribe(channel);
    subscriber.on('message', (...args: unknown[]) => {
      if (closed) return;
      const message = typeof args[1] === 'string' ? args[1] : '';
      try {
        const parsed = JSON.parse(message) as { profileId?: string; kind?: string; at_ms?: number };
        if (parsed.profileId !== profileId) return;
        const id = String(parsed.at_ms ?? Date.now());
        const data = JSON.stringify({ profileId: parsed.profileId, kind: parsed.kind, at_ms: parsed.at_ms });
        raw.write(`id: ${id}\nevent: watch_changed\ndata: ${data}\n\n`);
      } catch {
        // ignore malformed messages
      }
    });

    request.raw.on('close', finish);
    raw.on('close', finish);
  });
}

function toPlayableMediaType(type: string): 'movie' | 'show' | 'season' | 'episode' {
  if (type === 'movie' || type === 'show' || type === 'season' || type === 'episode') {
    return type;
  }
  return 'movie';
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

function parseOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseNullableString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return parseOptionalString(value);
}
