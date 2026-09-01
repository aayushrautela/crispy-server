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
  type MetadataCardsBatchBody,
  type MetadataItemParams,
  type MetadataPlaybackResolveQuery,
  type MetadataPersonParams,
  type MetadataPersonQuery,
  type MetadataSearchQuery,
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
import { MetadataCardService } from '../../modules/metadata/metadata-card.service.js';
import { toClientMediaCard } from '../../modules/metadata/client-media-card.mapper.js';
import type { ClientMediaCard, ClientMediaCardQueryResult } from '../../modules/recommendations/client-home.types.js';
import type { MediaIdentity } from '../../modules/identity/media-key.js';
import { withDbClient } from '../../lib/db.js';
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
    const internal = await metadataTitleExtrasService.getTitleExtrasInternal(params.itemId, language);
    const [similar, collection, seasons] = await withDbClient(async (client) => {
      const metadataCardService = new MetadataCardService();
      const hydrate = async (
        identities: MediaIdentity[],
        overrides?: { seriesItemId?: string; seriesTitle?: string },
      ): Promise<ClientMediaCard[]> => {
        if (!identities.length) return [];
        const views = await metadataCardService.buildCardViews(client, identities, language);
        const cards: ClientMediaCard[] = [];
        for (const view of views) {
          if (!view || !view.title) continue;
          cards.push(toClientMediaCard(view, { progress: null, ...overrides }));
        }
        return cards;
      };
      const similarCards = await hydrate(internal.similar);
      let collectionResult: ClientMediaCardQueryResult | null = null;
      if (internal.collection && internal.collection.length) {
        const collectionCards = await hydrate(internal.collection);
        if (collectionCards.length) {
          collectionResult = { Items: collectionCards, StartIndex: 0, TotalRecordCount: collectionCards.length, NextCursor: null, HasMore: false };
        }
      }
      const seasonCards = await hydrate(internal.seasonIdentities, {
        seriesItemId: internal.seriesItemId || undefined,
        seriesTitle: internal.seriesTitle ?? undefined,
      });
      return [similarCards, collectionResult, seasonCards] as const;
    });
    return success({
      Seasons: seasons,
      Reviews: internal.reviews,
      Similar: similar,
      Collection: collection,
      CollectionName: internal.collectionName,
    });
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
    const internal = await personDetailService.getPersonDetailInternal(params.personId, language);
    const knownFor = await withDbClient(async (client) => {
      if (!internal.knownForIdentities.length) return [];
      const metadataCardService = new MetadataCardService();
      const views = await metadataCardService.buildCardViews(client, internal.knownForIdentities, language);
      const cards = [];
      for (const view of views) {
        if (!view || !view.title) continue;
        cards.push(toClientMediaCard(view, { progress: null }));
      }
      return cards;
    });
    return success({
      personId: internal.personId,
      name: internal.name,
      knownForDepartment: internal.knownForDepartment,
      biography: internal.biography,
      birthday: internal.birthday,
      placeOfBirth: internal.placeOfBirth,
      profileUrl: internal.profileUrl,
      socials: internal.socials,
      knownFor,
    });
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
    // Phase 4c: hydration at route boundary — service returns identities only
    const internal = await titleSearchService.searchTitlesInternal({ query: searchQuery, genre, filter, limit, locale });
    if (!internal.tmdbMatches.length && !internal.peopleMatches.length) {
      return success({ query: internal.normalizedQuery, movies: [], series: [], people: [] });
    }
    const result = await withDbClient(async (client) => {
      const { ContentIdentityService } = await import('../../modules/identity/content-identity.service.js');
      const { TmdbCacheService } = await import('../../modules/metadata/providers/tmdb-cache.service.js');
      const { buildMetadataCardView } = await import('../../modules/metadata/metadata-card.builders.js');
      const { toClientMediaCard } = await import('../../modules/metadata/client-media-card.mapper.js');
      const { inferMediaIdentity } = await import('../../modules/identity/media-key.js');
      const { encodePublicItemId } = await import('../../modules/identity/public-item-id.js');
      const contentIdentityService = new ContentIdentityService();
      const tmdbCacheService = new TmdbCacheService();
      const metadataCardService = new MetadataCardService();
      const tmdbMatches = internal.tmdbMatches;
      const tmdbIdentities = tmdbMatches.map((m) => inferMediaIdentity({ mediaType: m.mediaType === 'movie' ? 'movie' : 'show', tmdbId: m.tmdbId }));
      const contentIds = await contentIdentityService.ensureContentIds(client, tmdbIdentities);
      const hydratedMap = await tmdbCacheService.getTitles(client, tmdbMatches.map((m) => ({ mediaType: m.mediaType, tmdbId: m.tmdbId })), locale);
      const cards: import('../../modules/recommendations/client-home.types.js').ClientMediaCard[] = [];
      for (const match of tmdbMatches) {
        const identity = inferMediaIdentity({ mediaType: match.mediaType === 'movie' ? 'movie' : 'show', tmdbId: match.tmdbId });
        const contentId = contentIds.get(identity.mediaKey);
        if (!contentId) continue;
        const hydrated = hydratedMap.get(`${match.mediaType}:${match.tmdbId}`);
        if (!hydrated) continue;
        const view = buildMetadataCardView({ identity, itemId: encodePublicItemId(contentId), title: hydrated, language: locale });
        cards.push(toClientMediaCard(view, { progress: null }));
      }
      // Boundary filtering: hasSearchArtwork (display concern) after hydration
      const withArtwork = cards.filter((c) => {
        const a = c.images.artwork;
        return Boolean(a && (a.small || a.medium || a.large));
      });
      const movies = withArtwork.filter((c) => c.mediaType === 'movie').slice(0, 20);
      const series = withArtwork.filter((c) => c.mediaType === 'tv').slice(0, 20);
      return { query: internal.normalizedQuery, movies, series, people: internal.peopleMatches };
    });
    return success(result);
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
