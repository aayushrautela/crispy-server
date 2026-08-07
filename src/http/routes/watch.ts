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
  watchlistListRouteSchema,
  type WatchContinueWatchingDismissParams,
  type WatchEventBody,
  type WatchMutationBody,
  type WatchPaginationQuery,
  type WatchStateBatchBody,
  type WatchStateLookupContract,
} from '../contracts/watch.js';
import { LocalUserWatchService } from '../../modules/integrations/local-user-watch.service.js';
import { HttpError } from '../../lib/errors.js';
import { withDbClient } from '../../lib/db.js';
import { WatchCardHydrator } from '../../modules/watch/watch-card-hydrator.service.js';
import { MetadataLanguageService } from '../../modules/metadata/metadata-language.service.js';
import { mutation, success } from '../response.js';
import { assertPublicItemId, decodePublicItemId } from '../../modules/identity/public-item-id.js';
import { ContentIdentityService } from '../../modules/identity/content-identity.service.js';
import { ContentIdentityRepository } from '../../modules/identity/content-identity.repo.js';
import { requireProfileUnlock } from '../plugins/profile-unlock-guard.js';

export interface WatchRoutesDeps {
  profilePinService?: {
    hasPin(profileId: string): Promise<boolean>;
  };
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
      const publicTitleId = await contentIdentityService.resolveTitleItemIdForPlayableItemId(client, body.itemId!);
      const titleItemId = decodePublicItemId(publicTitleId);
      const contentItem = await contentIdentityRepo.findContentItemById(client, playableItemId);
      if (!contentItem) throw new HttpError(404, 'Content item not found');
      return { titleItemId, mediaType: toPlayableMediaType(contentItem.entityType) };
    });
    await localUserWatchService.recordPlaybackState({
      accountId: actor.authSubject!,
      profileId,
      itemId: playableItemId,
      titleItemId: resolved.titleItemId,
      mediaType: resolved.mediaType,
      positionSeconds: typeof body.positionSeconds === 'number' ? body.positionSeconds : null,
      durationSeconds: typeof body.durationSeconds === 'number' ? body.durationSeconds : null,
      eventKind: String(body.eventType ?? '') === 'playback_completed' ? 'playback_completed' : 'playback_progress',
      occurredAt: typeof body.occurredAt === 'string' ? body.occurredAt : null,
      clientEventId: typeof body.clientEventId === 'string' ? body.clientEventId : null,
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
        watchCardHydrator.hydrateItems(client, page.items, language),
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

  app.delete('/v1/profiles/:profileId/watch/continue-watching/:id', { schema: watchContinueWatchingDismissRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserSessionActor(request);
    const params = request.params as Partial<WatchContinueWatchingDismissParams> & { id: string };
    const profileId = getProfileIdFromParams(params);
    await assertProfileUnlocked(request, profileId);
    const playableItemId = assertPublicItemId(params.id);
    const resolved = await withDbClient(async (client) => {
      const publicTitleId = await contentIdentityService.resolveTitleItemIdForPlayableItemId(client, params.id!);
      const titleItemId = decodePublicItemId(publicTitleId);
      return { titleItemId };
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
        watchCardHydrator.hydrateItems(client, page.items, language),
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
        watchCardHydrator.hydrateItems(client, page.items, language),
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
        watchCardHydrator.hydrateItems(client, page.items, language),
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
      watchCardHydrator.hydrateItems(client, [item], language),
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
      watchCardHydrator.hydrateItems(client, stateItems, language),
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
      const publicTitleId = await contentIdentityService.resolveTitleItemIdForPlayableItemId(client, body.itemId!);
      const titleItemId = decodePublicItemId(publicTitleId);
      const contentItem = await contentIdentityRepo.findContentItemById(client, playableItemId);
      if (!contentItem) throw new HttpError(404, 'Content item not found');
      return { titleItemId, mediaType: toPlayableMediaType(contentItem.entityType) };
    });
    await localUserWatchService.markWatched({
      accountId: actor.authSubject!,
      profileId,
      itemId: playableItemId,
      titleItemId: resolved.titleItemId,
      mediaType: resolved.mediaType,
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
      const publicTitleId = await contentIdentityService.resolveTitleItemIdForPlayableItemId(client, body.itemId!);
      const titleItemId = decodePublicItemId(publicTitleId);
      const contentItem = await contentIdentityRepo.findContentItemById(client, playableItemId);
      if (!contentItem) throw new HttpError(404, 'Content item not found');
      return { titleItemId, mediaType: toPlayableMediaType(contentItem.entityType) };
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
