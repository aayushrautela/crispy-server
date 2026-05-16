import type { FastifyInstance } from 'fastify';
import {
  continueWatchingListRouteSchema,
  historyListRouteSchema,
  ratingsListRouteSchema,
  watchContinueWatchingDismissRouteSchema,
  watchEventsRouteSchema,
  watchMediaKeyMutationRouteSchema,
  watchMediaKeyParamsRouteSchema,
  watchMutationRouteSchema,
  watchStateRouteSchema,
  watchStatesRouteSchema,
  watchlistListRouteSchema,
  type WatchContinueWatchingDismissParams,
  type WatchEventBody,
  type WatchMediaKeyParams,
  type WatchMutationBody,
  type WatchPaginationQuery,
  type WatchStateBatchBody,
  type WatchStateLookupContract,
} from '../contracts/watch.js';
import { LocalUserWatchService } from '../../modules/integrations/local-user-watch.service.js';
import { canonicalTitleMediaKey, canonicalTitleMediaType, inferMediaIdentity, parseMediaKey } from '../../modules/identity/media-key.js';
import { HttpError } from '../../lib/errors.js';
import { nowIso } from '../../lib/time.js';
import type { WatchStateLookupInput } from '../../modules/watch/watch-read.types.js';
import { withDbClient } from '../../lib/db.js';
import { WatchSupabaseEnrichmentService } from '../../modules/watch/watch-supabase-enrichment.service.js';
import { MetadataLanguageService } from '../../modules/metadata/metadata-language.service.js';
import { mutation, success } from '../response.js';

export async function registerWatchRoutes(app: FastifyInstance): Promise<void> {
  const localUserWatchService = new LocalUserWatchService();
  const watchSupabaseEnrichmentService = new WatchSupabaseEnrichmentService();
  const metadataLanguageService = new MetadataLanguageService();

  app.post('/v1/profiles/:profileId/watch/events', { schema: watchEventsRouteSchema }, async (request, reply) => {
    await app.requireAuth(request);
    const actor = app.requireUserSessionActor(request);
    const profileId = getProfileIdFromParams(request.params);
    const body = (request.body ?? {}) as WatchEventBody;
    const identity = inferMediaIdentity({
      mediaKey: typeof body.mediaKey === 'string' ? body.mediaKey : undefined,
      mediaType: String(body.mediaType ?? ''),
      seasonNumber: parseNullableNumber(body.seasonNumber),
      episodeNumber: parseNullableNumber(body.episodeNumber),
      absoluteEpisodeNumber: parseNullableNumber(body.absoluteEpisodeNumber),
    });
    await localUserWatchService.recordPlaybackState({
      accountId: actor.authSubject!,
      profileId,
      mediaKey: identity.mediaKey,
      titleMediaKey: canonicalTitleMediaKey(identity),
      mediaType: identity.mediaType,
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
    const query = (request.query ?? {}) as WatchPaginationQuery;
    const limit = Number(query.limit ?? 20);
    const generatedAt = nowIso();
    const language = await metadataLanguageService.resolveForProfile(profileId, actor.appUserId);
    const page = await localUserWatchService.listContinueWatchingPage({
      accountId: actor.authSubject!,
      profileId,
      limit,
      cursor: parseNullableString(query.cursor),
    });
    const enrichedItems = page.items.length
      ? await withDbClient((client) =>
        watchSupabaseEnrichmentService.enrichContinueWatchingItems(client, page.items, language),
      )
      : page.items;
    return success({
      profileId,
      kind: 'continue-watching' as const,
      source: 'canonical_watch' as const,
      generatedAt,
      items: enrichedItems,
      pageInfo: page.pageInfo,
    });
  });

  app.delete('/v1/profiles/:profileId/watch/continue-watching/:id', { schema: watchContinueWatchingDismissRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserSessionActor(request);
    const params = request.params as Partial<WatchContinueWatchingDismissParams> & { id: string };
    const profileId = getProfileIdFromParams(params);
    const titleMediaKey = decodeContinueWatchingRouteId(params.id);
    await localUserWatchService.dismissContinueWatching({
      accountId: actor.authSubject!,
      profileId,
      titleMediaKey,
    });
    return mutation({ accepted: true, mode: 'synchronous' as const });
  });

  app.get('/v1/profiles/:profileId/watch/history', { schema: historyListRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserSessionActor(request);
    const profileId = getProfileIdFromParams(request.params);
    const query = (request.query ?? {}) as WatchPaginationQuery;
    const limit = Number(query.limit ?? 100);
    const generatedAt = nowIso();
    const language = await metadataLanguageService.resolveForProfile(profileId, actor.appUserId);
    const page = await localUserWatchService.listHistoryPage({
      accountId: actor.authSubject!,
      profileId,
      limit,
      cursor: parseNullableString(query.cursor),
      mediaKey: parseNullableString(query.mediaKey),
    });
    const enrichedItems = page.items.length
      ? await withDbClient((client) =>
        watchSupabaseEnrichmentService.enrichRegularMediaItems(client, page.items, language),
      )
      : page.items;
    return success({
      profileId,
      kind: 'history' as const,
      source: 'canonical_watch' as const,
      generatedAt,
      items: enrichedItems,
      pageInfo: page.pageInfo,
    });
  });

  app.get('/v1/profiles/:profileId/watch/watchlist', { schema: watchlistListRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserSessionActor(request);
    const profileId = getProfileIdFromParams(request.params);
    const query = (request.query ?? {}) as WatchPaginationQuery;
    const limit = Number(query.limit ?? 50);
    const generatedAt = nowIso();
    const language = await metadataLanguageService.resolveForProfile(profileId, actor.appUserId);
    const page = await localUserWatchService.listWatchlistPage({
      accountId: actor.authSubject!,
      profileId,
      limit,
      cursor: parseNullableString(query.cursor),
    });
    const enrichedItems = page.items.length
      ? await withDbClient((client) =>
        watchSupabaseEnrichmentService.enrichRegularMediaItems(client, page.items, language),
      )
      : page.items;
    return success({
      profileId,
      kind: 'watchlist' as const,
      source: 'canonical_watch' as const,
      generatedAt,
      items: enrichedItems,
      pageInfo: page.pageInfo,
    });
  });

  app.get('/v1/profiles/:profileId/watch/ratings', { schema: ratingsListRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserSessionActor(request);
    const profileId = getProfileIdFromParams(request.params);
    const query = (request.query ?? {}) as WatchPaginationQuery;
    const limit = Number(query.limit ?? 50);
    const generatedAt = nowIso();
    const language = await metadataLanguageService.resolveForProfile(profileId, actor.appUserId);
    const page = await localUserWatchService.listRatingsPage({
      accountId: actor.authSubject!,
      profileId,
      limit,
      cursor: parseNullableString(query.cursor),
    });
    const enrichedItems = page.items.length
      ? await withDbClient((client) =>
        watchSupabaseEnrichmentService.enrichRegularMediaItems(client, page.items, language),
      )
      : page.items;
    return success({
      profileId,
      kind: 'ratings' as const,
      source: 'canonical_watch' as const,
      generatedAt,
      items: enrichedItems,
      pageInfo: page.pageInfo,
    });
  });

  app.get('/v1/profiles/:profileId/watch/state', { schema: watchStateRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserSessionActor(request);
    const profileId = getProfileIdFromParams(request.params);
    const query = (request.query ?? {}) as WatchStateLookupContract;
    const language = await metadataLanguageService.resolveForProfile(profileId, actor.appUserId);
    const item = await localUserWatchService.getState({
      accountId: actor.authSubject!,
      profileId,
      mediaKeys: [mapStateLookupInput(query).mediaKey],
    });
    const enrichedItem = await withDbClient((client) =>
      watchSupabaseEnrichmentService.enrichRegularMediaItems(client, [item], language),
    );
    return success({
      profileId,
      source: 'canonical_watch' as const,
      generatedAt: nowIso(),
      item: enrichedItem[0] ?? item,
    });
  });

  app.post('/v1/profiles/:profileId/watch/states', { schema: watchStatesRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserSessionActor(request);
    const profileId = getProfileIdFromParams(request.params);
    const body = (request.body ?? {}) as WatchStateBatchBody;
    const items = Array.isArray(body.items) ? body.items : [];

    const language = await metadataLanguageService.resolveForProfile(profileId, actor.appUserId);
    const stateItems = await localUserWatchService.getStates({
      accountId: actor.authSubject!,
      profileId,
      mediaKeys: items.map((item) => mapStateLookupInput((item ?? {}) as WatchStateLookupContract).mediaKey),
    });
    const enrichedItems = stateItems.length
      ? await withDbClient((client) =>
        watchSupabaseEnrichmentService.enrichRegularMediaItems(client, stateItems, language),
      )
      : stateItems;
    return success({
      profileId,
      source: 'canonical_watch' as const,
      generatedAt: nowIso(),
      items: enrichedItems,
    });
  });

  app.post('/v1/profiles/:profileId/watch/mark-watched', { schema: watchMutationRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserSessionActor(request);
    const profileId = getProfileIdFromParams(request.params);
    const body = (request.body ?? {}) as WatchMutationBody;
    const identity = inferMediaIdentity({
      mediaKey: typeof body.mediaKey === 'string' ? body.mediaKey : undefined,
      mediaType: String(body.mediaType ?? ''),
      seasonNumber: parseNullableNumber(body.seasonNumber),
      episodeNumber: parseNullableNumber(body.episodeNumber),
      absoluteEpisodeNumber: parseNullableNumber(body.absoluteEpisodeNumber),
    });
    await localUserWatchService.markWatched({
      accountId: actor.authSubject!,
      profileId,
      mediaKey: identity.mediaKey,
      titleMediaKey: canonicalTitleMediaKey(identity),
      mediaType: identity.mediaType,
      occurredAt: typeof body.occurredAt === 'string' ? body.occurredAt : undefined,
    });
    return mutation({ accepted: true, mode: 'synchronous' as const });
  });

  app.post('/v1/profiles/:profileId/watch/unmark-watched', { schema: watchMutationRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserSessionActor(request);
    const profileId = getProfileIdFromParams(request.params);
    const body = (request.body ?? {}) as WatchMutationBody;
    const identity = inferMediaIdentity({
      mediaKey: typeof body.mediaKey === 'string' ? body.mediaKey : undefined,
      mediaType: String(body.mediaType ?? ''),
      seasonNumber: parseNullableNumber(body.seasonNumber),
      episodeNumber: parseNullableNumber(body.episodeNumber),
      absoluteEpisodeNumber: parseNullableNumber(body.absoluteEpisodeNumber),
    });
    await localUserWatchService.unmarkWatched({
      accountId: actor.authSubject!,
      profileId,
      mediaKey: identity.mediaKey,
      titleMediaKey: canonicalTitleMediaKey(identity),
      mediaType: identity.mediaType,
      occurredAt: typeof body.occurredAt === 'string' ? body.occurredAt : undefined,
    });
    return mutation({ accepted: true, mode: 'synchronous' as const });
  });

  app.put('/v1/profiles/:profileId/watch/watchlist/:mediaKey', { schema: watchMediaKeyMutationRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserSessionActor(request);
    const params = request.params as Partial<WatchMediaKeyParams> & { mediaKey: string };
    const profileId = getProfileIdFromParams(params);
    const body = (request.body ?? {}) as WatchMutationBody;
    const identity = inferMediaIdentity({
      mediaKey: params.mediaKey,
      mediaType: String(body.mediaType ?? ''),
      seasonNumber: parseNullableNumber(body.seasonNumber),
      episodeNumber: parseNullableNumber(body.episodeNumber),
      absoluteEpisodeNumber: parseNullableNumber(body.absoluteEpisodeNumber),
    });
    await localUserWatchService.setListItem({
      accountId: actor.authSubject!,
      profileId,
      listKind: 'watchlist',
      mediaKey: canonicalTitleMediaKey(identity),
      mediaType: canonicalTitleMediaType(identity),
    });
    return mutation({ accepted: true, mode: 'synchronous' as const });
  });

  app.delete('/v1/profiles/:profileId/watch/watchlist/:mediaKey', { schema: watchMediaKeyParamsRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserSessionActor(request);
    const params = request.params as Partial<WatchMediaKeyParams> & { mediaKey: string };
    const profileId = getProfileIdFromParams(params);
    const identity = parseMediaKey(params.mediaKey);
    await localUserWatchService.deleteListItem({
      accountId: actor.authSubject!,
      profileId,
      listKind: 'watchlist',
      mediaKey: canonicalTitleMediaKey(identity),
    });
    return mutation({ accepted: true, mode: 'synchronous' as const });
  });

  app.put('/v1/profiles/:profileId/watch/rating/:mediaKey', { schema: watchMediaKeyMutationRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserSessionActor(request);
    const params = request.params as Partial<WatchMediaKeyParams> & { mediaKey: string };
    const profileId = getProfileIdFromParams(params);
    const body = (request.body ?? {}) as WatchMutationBody;
    if (typeof body.rating !== 'number') {
      throw new HttpError(400, 'Rating must be between 1 and 10.');
    }
    const identity = inferMediaIdentity({
      mediaKey: params.mediaKey,
      mediaType: String(body.mediaType ?? ''),
      seasonNumber: parseNullableNumber(body.seasonNumber),
      episodeNumber: parseNullableNumber(body.episodeNumber),
      absoluteEpisodeNumber: parseNullableNumber(body.absoluteEpisodeNumber),
    });
    await localUserWatchService.setRating({
      accountId: actor.authSubject!,
      profileId,
      mediaKey: canonicalTitleMediaKey(identity),
      mediaType: canonicalTitleMediaType(identity),
      rating: body.rating,
    });
    return mutation({ accepted: true, mode: 'synchronous' as const });
  });

  app.delete('/v1/profiles/:profileId/watch/rating/:mediaKey', { schema: watchMediaKeyParamsRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserSessionActor(request);
    const params = request.params as Partial<WatchMediaKeyParams> & { mediaKey: string };
    const profileId = getProfileIdFromParams(params);
    const identity = parseMediaKey(params.mediaKey);
    await localUserWatchService.deleteRating({
      accountId: actor.authSubject!,
      profileId,
      mediaKey: canonicalTitleMediaKey(identity),
    });
    return mutation({ accepted: true, mode: 'synchronous' as const });
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
    mediaKey: typeof query.mediaKey === 'string' ? query.mediaKey : '',
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
function decodeContinueWatchingRouteId(id: string): string {
  const trimmed = id.trim();
  if (!trimmed) {
    throw new HttpError(400, 'Continue watching id is required.');
  }
  return trimmed.startsWith('cw2:') ? trimmed.slice('cw2:'.length) : trimmed;
}
