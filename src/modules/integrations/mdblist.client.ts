import { HttpError } from '../../lib/errors.js';
import type {
  MdbListMediaType,
  MdbListRatingsRequest,
  MdbListRatingsResponse,
  MdbListReturnRating,
  MdbListTitleResponse,
} from './mdblist.types.js';

type FetchLike = typeof fetch;

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

export class MdbListClient {
  private baseUrl = 'https://api.mdblist.com';

  constructor(private readonly fetcher: FetchLike = fetch) {}

  async fetchMovieByTmdb(apiKey: string, tmdbId: number): Promise<MdbListTitleResponse> {
    const pathname = `/movie/tmdb/${tmdbId}`;
    const url = this.buildApiKeyUrl(pathname, apiKey);

    const response = await this.fetcher(url, {
      headers: {
        Accept: 'application/json',
      },
    });

    if (response.status === 404) {
      throw new HttpError(404, `MDBList movie not found for TMDB id ${tmdbId}`);
    }

    if (!response.ok) {
      throw new HttpError(response.status, `MDBList request failed for ${pathname}`);
    }

    return (await readJson(response, pathname)) as unknown as MdbListTitleResponse;
  }

  async fetchShowByTmdb(apiKey: string, tmdbId: number): Promise<MdbListTitleResponse> {
    const pathname = `/show/tmdb/${tmdbId}`;
    const url = this.buildApiKeyUrl(pathname, apiKey);

    const response = await this.fetcher(url, {
      headers: {
        Accept: 'application/json',
      },
    });

    if (response.status === 404) {
      throw new HttpError(404, `MDBList show not found for TMDB id ${tmdbId}`);
    }

    if (!response.ok) {
      throw new HttpError(response.status, `MDBList request failed for ${pathname}`);
    }

    return (await readJson(response, pathname)) as unknown as MdbListTitleResponse;
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
    const pathname = `/rating/${mediaType}/${returnRating}`;
    const url = this.buildApiKeyUrl(pathname, apiKey);

    const response = await this.fetcher(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (response.status === 404) {
      throw new HttpError(404, `MDBList ratings not found for ${pathname}`);
    }

    if (!response.ok) {
      throw new HttpError(response.status, `MDBList request failed for ${pathname}`);
    }

    return (await readJson(response, pathname)) as unknown as MdbListRatingsResponse;
  }

  private buildApiKeyUrl(pathname: string, apiKey: string): string {
    const normalized = apiKey.trim();
    if (!normalized) {
      throw new Error('MDBList API key is required');
    }
    return `${this.baseUrl}${pathname}?apikey=${encodeURIComponent(normalized)}`;
  }
}
