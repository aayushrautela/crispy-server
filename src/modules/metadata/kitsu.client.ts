import { appConfig } from '../../config/app-config.js';
import { env } from '../../config/env.js';
import { HttpError } from '../../lib/errors.js';

type FetchLike = typeof fetch;

function kitsuBaseUrl(): string {
  return env.kitsuBaseUrl || appConfig.metadata.kitsu.baseUrl;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
}

async function readJson(response: Response, pathname: string): Promise<Record<string, unknown>> {
  const payload = await response.json().catch(() => null);
  const record = asRecord(payload);
  if (!record) {
    throw new HttpError(502, `Kitsu returned an invalid response for ${pathname}`);
  }
  return record;
}

export class KitsuClient {
  constructor(private readonly fetcher: FetchLike = fetch) {}

  async searchAnime(query: string, limit = 20): Promise<Record<string, unknown>> {
    return this.request('/anime', {
      'filter[text]': query,
      'page[limit]': limit,
    });
  }

  async fetchAnime(animeId: string | number, include = 'episodes,mappings,categories'): Promise<Record<string, unknown>> {
    return this.request(`/anime/${encodeURIComponent(String(animeId))}`, {
      include,
    });
  }

  async fetchAnimeEpisodes(animeId: string | number, limit = 20, offset = 0): Promise<Record<string, unknown>> {
    return this.request('/episodes', {
      'filter[mediaId]': animeId,
      'page[limit]': limit,
      'page[offset]': offset,
    });
  }

  private async request(
    pathname: string,
    query: Record<string, string | number | undefined> = {},
  ): Promise<Record<string, unknown>> {
    const url = new URL(`${kitsuBaseUrl().replace(/\/$/, '')}${pathname}`);
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) {
        continue;
      }
      url.searchParams.set(key, String(value));
    }

    const response = await this.fetcher(url, {
      headers: {
        Accept: 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json',
      },
    });

    if (response.status === 404) {
      throw new HttpError(404, `Kitsu resource not found for ${pathname}`);
    }

    if (!response.ok) {
      throw new HttpError(response.status, `Kitsu request failed for ${pathname}`);
    }

    return readJson(response, pathname);
  }
}
