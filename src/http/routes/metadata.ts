import type { FastifyInstance } from 'fastify';
import {
  metadataCardsBatchRouteSchema,
  metadataItemDetailRouteSchema,
  metadataItemExtrasRouteSchema,
  metadataSeriesEpisodesRouteSchema,
  metadataItemRatingsRouteSchema,
  metadataPersonRouteSchema,
  metadataSearchRouteSchema,
  playbackResolveRouteSchema,
  searchSuggestionsRouteSchema,
  type MetadataCardsBatchBody,
  type MetadataItemParams,
  type MetadataPlaybackResolveQuery,
  type MetadataPersonParams,
  type MetadataPersonQuery,
  type MetadataSearchQuery,
  type MetadataSearchSuggestionsQuery,
} from '../contracts/metadata.js';
import { HttpError } from '../../lib/errors.js';
import { MetadataDetailService } from '../../modules/metadata/metadata-detail.service.js';
import { MetadataTitleExtrasService } from '../../modules/metadata/metadata-title-extras.service.js';
import { PersonDetailService } from '../../modules/metadata/person-detail.service.js';
import { PlaybackResolveService } from '../../modules/metadata/playback-resolve.service.js';
import { MetadataRatingsService } from '../../modules/metadata/metadata-ratings.service.js';
import type { MetadataSearchFilter } from '../../modules/metadata/metadata-detail.types.js';
import { TitleSearchService } from '../../modules/search/title-search.service.js';
import { MetadataCardBatchService } from '../../modules/metadata/metadata-card-batch.service.js';
import { MetadataLanguageService } from '../../modules/metadata/metadata-language.service.js';
import { success } from '../response.js';

export async function registerMetadataRoutes(app: FastifyInstance): Promise<void> {
  const metadataDetailService = new MetadataDetailService();
  const metadataTitleExtrasService = new MetadataTitleExtrasService();
  const titleSearchService = new TitleSearchService();
  const metadataRatingsService = new MetadataRatingsService();
  const personDetailService = new PersonDetailService();
  const playbackResolveService = new PlaybackResolveService();
  const metadataCardBatchService = new MetadataCardBatchService();
  const metadataLanguageService = new MetadataLanguageService();

  app.get('/v1/metadata/items/:itemId', { schema: metadataItemDetailRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const params = request.params as MetadataItemParams;
    const query = (request.query ?? {}) as MetadataPersonQuery;
    const actor = app.requireUserActor(request) as { appUserId: string };
    const language = await metadataLanguageService.resolveForAccount(actor.appUserId, asOptionalString(query.language));
    return success(await metadataDetailService.getItemDetail(params.itemId, language));
  });

  app.get('/v1/metadata/items/:itemId/extras', { schema: metadataItemExtrasRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const params = request.params as MetadataItemParams;
    const query = (request.query ?? {}) as MetadataPersonQuery;
    const actor = app.requireUserActor(request) as { appUserId: string };
    const language = await metadataLanguageService.resolveForAccount(actor.appUserId, asOptionalString(query.language));
    return success(await metadataTitleExtrasService.getTitleExtras(params.itemId, language));
  });

  app.get('/v1/metadata/shows/:itemId/episodes', { schema: metadataSeriesEpisodesRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const params = request.params as MetadataItemParams;
    const query = (request.query ?? {}) as MetadataPersonQuery & { season?: number | string };
    const actor = app.requireUserActor(request) as { appUserId: string };
    const language = await metadataLanguageService.resolveForAccount(actor.appUserId, asOptionalString(query.language));
    const season = query.season !== undefined ? Number(query.season) : null;
    return success(await metadataDetailService.getSeriesEpisodes(params.itemId, language, season));
  });

  app.get('/v1/profiles/:profileId/metadata/items/:itemId/ratings', { schema: metadataItemRatingsRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const params = request.params as { profileId: string; itemId: string };
    return success(await metadataRatingsService.getTitleRatings(actor.appUserId, params.profileId, params.itemId));
  });

  app.get('/v1/metadata/people/:personId', { schema: metadataPersonRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const params = request.params as MetadataPersonParams;
    const query = (request.query ?? {}) as MetadataPersonQuery;
    const actor = app.requireUserActor(request) as { appUserId: string };
    const language = await metadataLanguageService.resolveForAccount(actor.appUserId, asOptionalString(query.language));
    return success(await personDetailService.getPersonDetail(params.personId, language));
  });

  app.get('/v1/playback/resolve', { schema: playbackResolveRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const query = (request.query ?? {}) as MetadataPlaybackResolveQuery;
    const actor = app.requireUserActor(request) as { appUserId: string };
    const language = await metadataLanguageService.resolveForAccount(actor.appUserId, asOptionalString(query.language));
    return success(await playbackResolveService.resolvePlayback({
      itemId: query.itemId,
      language,
    }));
  });

  app.get('/v1/search/titles', { schema: metadataSearchRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const query = (request.query ?? {}) as MetadataSearchQuery;
    const searchQuery = asOptionalString(query.query) ?? '';
    const genre = asOptionalString(query.genre);
    const filter = parseSearchFilter(query.filter);
    const limit = clampLimit(parseOptionalNumber(query.limit) ?? 20, 1, 50);
    const locale = await metadataLanguageService.resolveForAccount(
      (app.requireUserActor(request) as { appUserId: string }).appUserId,
      asOptionalString(query.locale),
    );
    return success(await titleSearchService.searchTitles({ query: searchQuery, genre, filter, limit, locale }));
  });

  app.get('/v1/search/suggestions', { schema: searchSuggestionsRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const query = (request.query ?? {}) as MetadataSearchSuggestionsQuery;
    const searchQuery = asOptionalString(query.query) ?? '';
    const filter = parseSearchFilter(query.filter);
    const limit = clampLimit(parseOptionalNumber(query.limit) ?? 8, 1, 10);
    const locale = await metadataLanguageService.resolveForAccount(
      (app.requireUserActor(request) as { appUserId: string }).appUserId,
      asOptionalString(query.locale),
    );
    return success({ suggestions: await titleSearchService.suggestTitles({ query: searchQuery, filter, limit, locale }) });
  });

  app.post('/v1/metadata/cards/batch', { schema: metadataCardsBatchRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const body = (request.body ?? {}) as MetadataCardsBatchBody;

    const actor = app.requireUserActor(request) as { appUserId: string };
    const language = await metadataLanguageService.resolveForAccount(actor.appUserId, asOptionalString(body.language));
    return success(await metadataCardBatchService.hydrate({
      itemIds: body.itemIds ?? [],
      language,
    }));
  });
}

function asOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseOptionalNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function parseSearchFilter(value: unknown): MetadataSearchFilter {
  if (value === 'movies' || value === 'series' || value === 'people') {
    return value;
  }
  if (value === undefined || value === null || value === '' || value === 'all') {
    return 'all';
  }
  throw new HttpError(400, 'Invalid search filter.');
}

function clampLimit(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
