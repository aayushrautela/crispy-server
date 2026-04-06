import { appConfig } from '../../../config/app-config.js';
import { env } from '../../../config/env.js';
import { HttpError } from '../../../lib/errors.js';

type FetchLike = typeof fetch;

const TVDB_TOKEN_TTL_MS = 27 * 24 * 60 * 60 * 1000;

function tvdbBaseUrl(): string {
  return appConfig.metadata.tvdb.baseUrl;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
}

async function readJson(response: Response, pathname: string): Promise<Record<string, unknown>> {
  const payload = await response.json().catch(() => null);
  const record = asRecord(payload);
  if (!record) {
    throw new HttpError(502, `TVDB returned an invalid response for ${pathname}`);
  }
  return record;
}

export class TvdbClient {
  private token: string | null = null;
  private tokenExpiresAt = 0;
  private tokenPromise: Promise<string> | null = null;

  constructor(private readonly fetcher: FetchLike = fetch) {}

  async searchSeries(query: string, limit = 20, offset = 0): Promise<Record<string, unknown>> {
    return this.request('/search', {
      query,
      type: 'series',
      limit,
      offset,
    });
  }

  async searchByRemoteId(remoteId: string): Promise<Record<string, unknown>> {
    return this.request(`/search/remoteid/${encodeURIComponent(remoteId)}`);
  }

  async fetchSeriesExtended(seriesId: string | number, meta = 'translations,episodes'): Promise<Record<string, unknown>> {
    return this.request(`/series/${encodeURIComponent(String(seriesId))}/extended`, {
      meta,
    });
  }

  async fetchSeriesEpisodes(
    seriesId: string | number,
    seasonType: 'default' | 'official' | 'absolute' | 'dvd' = 'default',
    season?: number | null,
    page = 0,
  ): Promise<Record<string, unknown>> {
    return this.request(`/series/${encodeURIComponent(String(seriesId))}/episodes/${seasonType}`, {
      season: season ?? undefined,
      page,
    });
  }

  async fetchEpisodeExtended(episodeId: string | number): Promise<Record<string, unknown>> {
    return this.request(`/episodes/${encodeURIComponent(String(episodeId))}/extended`);
  }

  async fetchSeasonExtended(seasonId: string | number): Promise<Record<string, unknown>> {
    return this.request(`/seasons/${encodeURIComponent(String(seasonId))}/extended`);
  }

  private async request(
    pathname: string,
    query: Record<string, string | number | undefined> = {},
    allowRetry = true,
  ): Promise<Record<string, unknown>> {
    const token = await this.getToken();
    const url = new URL(`${tvdbBaseUrl().replace(/\/$/, '')}${pathname}`);
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) {
        continue;
      }
      url.searchParams.set(key, String(value));
    }

    const response = await this.fetcher(url, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });

    if (response.status === 401 && allowRetry) {
      await this.refreshToken();
      return this.request(pathname, query, false);
    }

    if (response.status === 404) {
      throw new HttpError(404, `TVDB resource not found for ${pathname}`);
    }

    if (!response.ok) {
      throw new HttpError(response.status, `TVDB request failed for ${pathname}`);
    }

    return readJson(response, pathname);
  }

  private async getToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt) {
      return this.token;
    }

    if (!this.tokenPromise) {
      this.tokenPromise = this.login().finally(() => {
        this.tokenPromise = null;
      });
    }

    return this.tokenPromise;
  }

  private async refreshToken(): Promise<string> {
    this.token = null;
    this.tokenExpiresAt = 0;
    this.tokenPromise = this.login().finally(() => {
      this.tokenPromise = null;
    });
    return this.tokenPromise;
  }

  private async login(): Promise<string> {
    const url = new URL(`${tvdbBaseUrl().replace(/\/$/, '')}/login`);
    const body: Record<string, string> = {
      apikey: env.tvdbApiKey,
    };
    if (env.tvdbPin) {
      body.pin = env.tvdbPin;
    }

    const response = await this.fetcher(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new HttpError(response.status, 'TVDB login failed.');
    }

    const payload = await readJson(response, '/login');
    const token = asRecord(payload.data)?.token;
    if (typeof token !== 'string' || !token.trim()) {
      throw new HttpError(502, 'TVDB login returned an invalid token.');
    }

    this.token = token.trim();
    this.tokenExpiresAt = Date.now() + TVDB_TOKEN_TTL_MS;
    return this.token;
  }
}
