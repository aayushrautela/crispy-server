import { HttpError } from '../../lib/errors.js';

export type MediaIdentity = {
  mediaKey: string;
  mediaType: string;
  tmdbId: number | null;
  showTmdbId: number | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
};

export function inferMediaIdentity(input: {
  mediaKey?: string;
  mediaType: string;
  tmdbId?: number | null;
  showTmdbId?: number | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
}): MediaIdentity {
  if (input.mediaKey?.trim()) {
    return {
      mediaKey: input.mediaKey.trim(),
      mediaType: input.mediaType,
      tmdbId: input.tmdbId ?? null,
      showTmdbId: input.showTmdbId ?? null,
      seasonNumber: input.seasonNumber ?? null,
      episodeNumber: input.episodeNumber ?? null,
    };
  }

  if (input.mediaType === 'movie' && input.tmdbId) {
    return {
      mediaKey: `movie:tmdb:${input.tmdbId}`,
      mediaType: 'movie',
      tmdbId: input.tmdbId,
      showTmdbId: null,
      seasonNumber: null,
      episodeNumber: null,
    };
  }

  if (
    input.mediaType === 'episode' &&
    input.showTmdbId &&
    input.seasonNumber !== undefined &&
    input.seasonNumber !== null &&
    input.episodeNumber !== undefined &&
    input.episodeNumber !== null
  ) {
    return {
      mediaKey: `episode:tmdb:${input.showTmdbId}:${input.seasonNumber}:${input.episodeNumber}`,
      mediaType: 'episode',
      tmdbId: input.tmdbId ?? null,
      showTmdbId: input.showTmdbId,
      seasonNumber: input.seasonNumber,
      episodeNumber: input.episodeNumber,
    };
  }

  if (input.mediaType === 'show' && input.tmdbId) {
    return {
      mediaKey: `show:tmdb:${input.tmdbId}`,
      mediaType: 'show',
      tmdbId: input.tmdbId,
      showTmdbId: input.tmdbId,
      seasonNumber: null,
      episodeNumber: null,
    };
  }

  throw new HttpError(400, 'Unable to infer media identity.');
}
