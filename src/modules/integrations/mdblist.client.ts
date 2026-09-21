import { HttpError } from '../../lib/errors.js';
import type {
  MdbListMediaType,
  MdbListRatingsRequest,
  MdbListRatingsResponse,
  MdbListReturnRating,
  MdbListTitleResponse,
} from './mdblist.types.js';

type FetchLike = typeof fetch;
const MDBLIST_ERROR_BODY_LIMIT = 500;

const REQUEST_TIMEOUT_MS = 2_000;
// List responses can be large (up to a few MB), so give them more headroom
// than the single-title lookups.
const LIST_REQUEST_TIMEOUT_MS = 10_000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

async function readJson(response: Response, pathname: string): Promise<Record<string, unknown>> {
  const payload = await response.json().catch(() => null);
  const record = asRecord(payload);
  if (!record) {
    throw new HttpError(502, `MDBList returned an invalid response for ${pathname}`);
  }
  return record;
}

async function readErrorDetails(response: Response): Promise<{ contentType: string | null; bodySnippet: string | null }> {
  const contentType = response.headers.get('content-type');
  const rawBody = await response.text().catch(() => '');
  const bodySnippet = rawBody.trim().slice(0, MDBLIST_ERROR_BODY_LIMIT) || null;
  return { contentType, bodySnippet };
}

export class MdbListClient {
  private baseUrl = 'https://api.mdblist.com';

  constructor(private readonly fetcher: FetchLike = fetch) {}

  async fetchMovieByTmdb(apiKey: string, tmdbId: number): Promise<MdbListTitleResponse> {
    return this.requestJson('GET', `/movie/tmdb/${tmdbId}`, apiKey, {
      pathname: `/movie/tmdb/${tmdbId}`,
      mediaType: 'movie',
      lookupProvider: 'tmdb',
      lookupId: tmdbId,
    });
  }

  async fetchShowByTmdb(apiKey: string, tmdbId: number): Promise<MdbListTitleResponse> {
    return this.requestJson('GET', `/show/tmdb/${tmdbId}`, apiKey, {
      pathname: `/show/tmdb/${tmdbId}`,
      mediaType: 'show',
      lookupProvider: 'tmdb',
      lookupId: tmdbId,
    });
  }

  async fetchTitle(apiKey: string, mediaType: MdbListMediaType, tmdbId: number): Promise<MdbListTitleResponse> {
    if (mediaType === 'movie') {
      return this.fetchMovieByTmdb(apiKey, tmdbId);
    }
    return this.fetchShowByTmdb(apiKey, tmdbId);
  }

  async fetchRatings(
    apiKey: string,
    mediaType: MdbListMediaType,
    returnRating: MdbListReturnRating,
    request: MdbListRatingsRequest,
  ): Promise<MdbListRatingsResponse> {
    return this.requestJson('POST', `/rating/${mediaType}/${returnRating}`, apiKey, {
      pathname: `/rating/${mediaType}/${returnRating}`,
      mediaType,
      returnRating,
      request,
    }, JSON.stringify(request));
  }

  /**
   * Fetch a list's info (name, description, mediatype, item count) by its
   * username/slug pair. Returns the raw parsed payload (the endpoint responds
   * with a singleton array) or null when the list does not exist.
   */
  async fetchList(username: string, slug: string, apiKey: string): Promise<unknown> {
    const pathname = `/lists/${encodeURIComponent(username)}/${encodeURIComponent(slug)}`;
    return this.requestList(pathname, apiKey, { username, slug });
  }

  /**
   * Fetch the items of a list, optionally filtered to a single media type.
   * The endpoint responds either as a wrapper object ({ movies, shows }) or a
   * flat array; the raw entries are returned as-is and normalized upstream.
   * A missing list is reported as an empty array.
   */
  async fetchListItems(
    username: string,
    slug: string,
    apiKey: string,
    options?: { mediaType?: 'movie' | 'show' | null; limit?: number; offset?: number },
  ): Promise<Array<Record<string, unknown>>> {
    const query = new URLSearchParams();
    if (options?.mediaType) query.set('mediatype', options.mediaType);
    if (options?.limit) query.set('limit', String(options.limit));
    if (options?.offset) query.set('offset', String(options.offset));
    const qs = query.toString();
    const pathname = `/lists/${encodeURIComponent(username)}/${encodeURIComponent(slug)}/items${qs ? `?${qs}` : ''}`;
    const payload = await this.requestList(pathname, apiKey, { username, slug });
    if (!Array.isArray(payload)) {
      const record = asRecord(payload);
      if (!record) return [];
      return [
        ...(Array.isArray(record.movies) ? (record.movies as Array<Record<string, unknown>>) : []),
        ...(Array.isArray(record.shows) ? (record.shows as Array<Record<string, unknown>>) : []),
      ];
    }
    return payload as Array<Record<string, unknown>>;
  }

  /**
   * Shared request path with a hard timeout. No retries: failures surface
   * immediately and the service layer keeps them out of the cache.
   */
  private async requestJson<T>(
    method: 'GET' | 'POST',
    pathname: string,
    apiKey: string,
    errorContext: Record<string, unknown>,
    body?: string,
  ): Promise<T> {
    const notFoundMessage = method === 'GET'
      ? `MDBList title not found for ${pathname}`
      : `MDBList ratings not found for ${pathname}`;
    const url = this.buildApiKeyUrl(pathname, apiKey);

    let response: Response;
    try {
      response = await this.fetcher(url, {
        method,
        headers: {
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body } : {}),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new HttpError(504, `MDBList request failed for ${pathname}`, {
        ...errorContext,
        response: null,
        reason: error instanceof Error ? error.message : 'network_error',
      });
    }

    if (response.status === 404) {
      throw new HttpError(404, notFoundMessage);
    }

    if (response.ok) {
      return (await readJson(response, pathname)) as unknown as T;
    }

    throw new HttpError(response.status, `MDBList request failed for ${pathname}`, {
      ...errorContext,
      response: await readErrorDetails(response),
    });
  }

  private buildApiKeyUrl(pathname: string, apiKey: string): string {
    const normalized = apiKey.trim();
    if (!normalized) {
      throw new Error('MDBList API key is required');
    }
    const separator = pathname.includes('?') ? '&' : '?';
    return `${this.baseUrl}${pathname}${separator}apikey=${encodeURIComponent(normalized)}`;
  }

  /**
   * Raw GET that returns the parsed JSON body as-is (may be an array or object).
   * 404 is reported as null instead of throwing so callers can treat it as "no data".
   */
  private async requestList(
    pathname: string,
    apiKey: string,
    errorContext: Record<string, unknown>,
    timeoutMs = LIST_REQUEST_TIMEOUT_MS,
  ): Promise<unknown> {
    const url = this.buildApiKeyUrl(pathname, apiKey);
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new HttpError(504, `MDBList request failed for ${pathname}`, {
        ...errorContext,
        response: null,
        reason: error instanceof Error ? error.message : 'network_error',
      });
    }
    if (response.status === 404) return null;
    if (response.ok) {
      return response.json().catch(() => null);
    }
    throw new HttpError(response.status, `MDBList request failed for ${pathname}`, {
      ...errorContext,
      response: await readErrorDetails(response),
    });
  }
}
