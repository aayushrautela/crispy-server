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
    return `${this.baseUrl}${pathname}?apikey=${encodeURIComponent(normalized)}`;
  }
}
