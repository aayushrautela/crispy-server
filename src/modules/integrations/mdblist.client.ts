import { HttpError } from '../../lib/errors.js';
import type { MdbListTitleResponse } from './mdblist.types.js';

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
  private apiKey: string;
  private baseUrl = 'https://api.mdblist.com';

  constructor(apiKey: string, private readonly fetcher: FetchLike = fetch) {
    if (!apiKey?.trim()) {
      throw new Error('MDBList API key is required');
    }
    this.apiKey = apiKey.trim();
  }

  async fetchMovieByTmdb(tmdbId: number): Promise<MdbListTitleResponse> {
    const pathname = `/movie/tmdb/${tmdbId}`;
    const url = `${this.baseUrl}${pathname}?apikey=${this.apiKey}`;

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

  async fetchShowByTmdb(tmdbId: number): Promise<MdbListTitleResponse> {
    const pathname = `/show/tmdb/${tmdbId}`;
    const url = `${this.baseUrl}${pathname}?apikey=${this.apiKey}`;

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

  async fetchByImdb(imdbId: string): Promise<MdbListTitleResponse> {
    const pathname = `/imdb/${imdbId}`;
    const url = `${this.baseUrl}${pathname}?apikey=${this.apiKey}`;

    const response = await this.fetcher(url, {
      headers: {
        Accept: 'application/json',
      },
    });

    if (response.status === 404) {
      throw new HttpError(404, `MDBList title not found for IMDb id ${imdbId}`);
    }

    if (!response.ok) {
      throw new HttpError(response.status, `MDBList request failed for ${pathname}`);
    }

    return (await readJson(response, pathname)) as unknown as MdbListTitleResponse;
  }

  async fetchTitle(mediaType: 'movie' | 'show', tmdbId: number): Promise<MdbListTitleResponse> {
    if (mediaType === 'movie') {
      return this.fetchMovieByTmdb(tmdbId);
    }
    return this.fetchShowByTmdb(tmdbId);
  }
}
