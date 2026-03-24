import { env } from '../../config/env.js';
import { HttpError } from '../../lib/errors.js';
import type {
  TmdbDiscoverApiResponse,
  TmdbPersonApiResponse,
  TmdbSeasonApiResponse,
  TmdbSearchApiResponse,
  TmdbTitleApiResponse,
  TmdbTitleType,
} from './tmdb.types.js';

async function fetchTmdbJson(
  pathname: string,
  query: Record<string, string | number | undefined> = {},
): Promise<Record<string, unknown>> {
  const url = new URL(`${env.tmdbBaseUrl.replace(/\/$/, '')}${pathname}`);
  url.searchParams.set('api_key', env.tmdbApiKey);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) {
      continue;
    }
    url.searchParams.set(key, String(value));
  }

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
    const appendToResponse = mediaType === 'movie' ? 'images,release_dates' : 'images,content_ratings';
    return fetchTmdbJson(`/${mediaType}/${tmdbId}`, {
      append_to_response: appendToResponse,
      include_image_language: 'en,null',
    });
  }

  async findByExternalId(externalId: string, externalSource: string): Promise<Record<string, unknown>> {
    return fetchTmdbJson(`/find/${encodeURIComponent(externalId)}`, {
      external_source: externalSource,
    });
  }

  async fetchExternalIds(mediaType: TmdbTitleType, tmdbId: number): Promise<Record<string, unknown>> {
    return fetchTmdbJson(`/${mediaType}/${tmdbId}/external_ids`);
  }

  async fetchSeason(showTmdbId: number, seasonNumber: number): Promise<TmdbSeasonApiResponse> {
    return fetchTmdbJson(`/tv/${showTmdbId}/season/${seasonNumber}`);
  }

  async fetchPerson(personTmdbId: number, language?: string | null): Promise<TmdbPersonApiResponse> {
    return fetchTmdbJson(`/person/${personTmdbId}`, {
      append_to_response: 'combined_credits,external_ids',
      language: language?.trim() || undefined,
    });
  }

  async searchTitles(query: string, page = 1): Promise<TmdbSearchApiResponse> {
    return fetchTmdbJson('/search/multi', {
      query,
      page,
      include_adult: 'false',
    });
  }

  async discoverTitlesByGenre(mediaType: TmdbTitleType, genreId: number, page = 1): Promise<TmdbDiscoverApiResponse> {
    return fetchTmdbJson(`/discover/${mediaType}`, {
      with_genres: genreId,
      page,
      sort_by: 'popularity.desc',
      include_adult: 'false',
    });
  }
}
