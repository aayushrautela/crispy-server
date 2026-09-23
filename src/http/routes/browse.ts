import type { FastifyInstance } from 'fastify';
import { HttpError } from '../../lib/errors.js';
import { BrowseTitlesService, type BrowseMediaType, type BrowseSort } from '../../modules/browse/browse-titles.service.js';
import { MetadataLanguageService } from '../../modules/metadata/metadata-language.service.js';
import type { BrowseTitlesQuery } from '../contracts/browse.js';
import { browseTitlesRouteSchema } from '../contracts/browse.js';
import { success } from '../response.js';

const ALLOWED_TYPES: BrowseMediaType[] = ['movie', 'series'];
const ALLOWED_SORTS: BrowseSort[] = ['popularity', 'rating', 'release'];
const DEFAULT_SORT: BrowseSort = 'popularity';
const MAX_PAGE = 19;

export async function registerBrowseRoutes(app: FastifyInstance): Promise<void> {
  const browseTitlesService = new BrowseTitlesService();
  const metadataLanguageService = new MetadataLanguageService();

  app.get('/v1/browse/titles', { schema: browseTitlesRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const query = (request.query ?? {}) as BrowseTitlesQuery;

    const type = parseType(query.type);
    const genre = asOptionalString(query.genre);
    const sort = parseSort(query.sort);
    const page = parsePage(query.page);
    const locale = await metadataLanguageService.resolveForAccount(actor.appUserId, asOptionalString(query.locale));

    return success(await browseTitlesService.browseTitles({ type, genreKey: genre, sort, page, locale }), request);
  });
}

function parseType(value: unknown): BrowseMediaType {
  if (typeof value === 'string' && ALLOWED_TYPES.includes(value as BrowseMediaType)) {
    return value as BrowseMediaType;
  }
  throw new HttpError(400, 'browse type must be one of: movie, series.');
}

function parseSort(value: unknown): BrowseSort {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_SORT;
  }
  if (typeof value === 'string' && ALLOWED_SORTS.includes(value as BrowseSort)) {
    return value as BrowseSort;
  }
  throw new HttpError(400, 'browse sort must be one of: popularity, rating, release.');
}

function parsePage(value: unknown): number {
  if (value === undefined || value === null || value === '') {
    return 0;
  }
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number.parseInt(value, 10) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_PAGE) {
    throw new HttpError(400, 'browse page must be an integer between 0 and 19.');
  }
  return parsed;
}

function asOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}