import { env } from '../../config/env.js';
import { HttpError } from '../../lib/errors.js';
import type { TmdbSeasonApiResponse, TmdbTitleApiResponse, TmdbTitleType } from './tmdb.types.js';

async function fetchTmdbJson(pathname: string): Promise<Record<string, unknown>> {
  const url = new URL(`${env.tmdbBaseUrl.replace(/\/$/, '')}${pathname}`);
  url.searchParams.set('api_key', env.tmdbApiKey);

  const response = await fetch(url);
  if (response.status === 404) {
    throw new HttpError(404, `TMDB resource not found for ${pathname}`);
  }
  if (!response.ok) {
    throw new HttpError(response.status, `TMDB request failed for ${pathname}`);
  }
  return (await response.json()) as Record<string, unknown>;
}

export class TmdbClient {
  async fetchTitle(mediaType: TmdbTitleType, tmdbId: number): Promise<TmdbTitleApiResponse> {
    return fetchTmdbJson(`/${mediaType}/${tmdbId}`);
  }

  async fetchExternalIds(mediaType: TmdbTitleType, tmdbId: number): Promise<Record<string, unknown>> {
    return fetchTmdbJson(`/${mediaType}/${tmdbId}/external_ids`);
  }

  async fetchSeason(showTmdbId: number, seasonNumber: number): Promise<TmdbSeasonApiResponse> {
    return fetchTmdbJson(`/tv/${showTmdbId}/season/${seasonNumber}`);
  }
}
