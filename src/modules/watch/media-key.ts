import { HttpError } from '../../lib/errors.js';

export type SupportedMediaType = 'movie' | 'show' | 'episode';

export type MediaIdentity = {
  mediaKey: string;
  mediaType: SupportedMediaType;
  tmdbId: number | null;
  showTmdbId: number | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
};

export function ensureSupportedMediaType(value: string): SupportedMediaType {
  if (value === 'movie' || value === 'show' || value === 'episode') {
    return value;
  }

  throw new HttpError(400, 'Unsupported media type.');
}

export function showTmdbIdForIdentity(identity: MediaIdentity): number | null {
  if (identity.mediaType === 'show') {
    return identity.tmdbId;
  }
  return identity.showTmdbId;
}

export function canonicalContinueWatchingMediaKey(identity: MediaIdentity): string {
  if (identity.mediaType === 'movie' && identity.tmdbId) {
    return `movie:tmdb:${identity.tmdbId}`;
  }

  const showTmdbId = showTmdbIdForIdentity(identity);
  if (showTmdbId) {
    return `show:tmdb:${showTmdbId}`;
  }

  throw new HttpError(400, 'Unable to infer canonical continue watching media key.');
}

export function parseMediaKey(mediaKey: string): MediaIdentity {
  const parts = mediaKey.split(':');
  if (parts.length < 3 || parts[1] !== 'tmdb') {
    throw new HttpError(400, 'Unsupported media key format.');
  }

  const mediaType = parts[0];
  if (mediaType === 'movie' || mediaType === 'show') {
    const tmdbId = Number(parts[2]);
    if (!Number.isFinite(tmdbId)) {
      throw new HttpError(400, 'Invalid TMDB id in media key.');
    }
    return {
      mediaKey,
      mediaType,
      tmdbId,
      showTmdbId: mediaType === 'show' ? tmdbId : null,
      seasonNumber: null,
      episodeNumber: null,
    };
  }

  if (mediaType === 'episode' && parts.length === 5) {
    const showTmdbId = Number(parts[2]);
    const seasonNumber = Number(parts[3]);
    const episodeNumber = Number(parts[4]);
    if (!Number.isFinite(showTmdbId) || !Number.isFinite(seasonNumber) || !Number.isFinite(episodeNumber)) {
      throw new HttpError(400, 'Invalid episode media key.');
    }
    return {
      mediaKey,
      mediaType,
      tmdbId: null,
      showTmdbId,
      seasonNumber,
      episodeNumber,
    };
  }

  throw new HttpError(400, 'Unsupported media key format.');
}

export function inferMediaIdentity(input: {
  mediaKey?: string;
  mediaType: string;
  tmdbId?: number | null;
  showTmdbId?: number | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
}): MediaIdentity {
  if (input.mediaKey?.trim()) {
    const parsed = parseMediaKey(input.mediaKey.trim());
    return {
      ...parsed,
      tmdbId: input.tmdbId ?? parsed.tmdbId,
      showTmdbId: input.showTmdbId ?? parsed.showTmdbId,
      seasonNumber: input.seasonNumber ?? parsed.seasonNumber,
      episodeNumber: input.episodeNumber ?? parsed.episodeNumber,
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
