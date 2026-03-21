import type { TmdbEpisodeRecord, TmdbTitleRecord } from './tmdb.types.js';

function toNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function toNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function mapRawEpisode(showTmdbId: number, raw: unknown): TmdbEpisodeRecord | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const row = raw as Record<string, unknown>;
  const seasonNumber = toNullableNumber(row.season_number);
  const episodeNumber = toNullableNumber(row.episode_number);
  if (seasonNumber === null || episodeNumber === null) {
    return null;
  }
  return {
    showTmdbId,
    seasonNumber,
    episodeNumber,
    tmdbId: toNullableNumber(row.id),
    name: toNullableString(row.name),
    overview: toNullableString(row.overview),
    airDate: toNullableString(row.air_date),
    runtime: toNullableNumber(row.runtime),
    stillPath: toNullableString(row.still_path),
    voteAverage: toNullableNumber(row.vote_average),
    raw: row,
    fetchedAt: new Date().toISOString(),
    expiresAt: new Date().toISOString(),
  };
}

export function extractNextEpisodeToAir(title: TmdbTitleRecord | null): TmdbEpisodeRecord | null {
  if (!title) {
    return null;
  }
  return mapRawEpisode(title.tmdbId, title.raw.next_episode_to_air);
}

export function extractLastEpisodeToAir(title: TmdbTitleRecord | null): TmdbEpisodeRecord | null {
  if (!title) {
    return null;
  }
  return mapRawEpisode(title.tmdbId, title.raw.last_episode_to_air);
}
