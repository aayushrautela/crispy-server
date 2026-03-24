import type { MetadataEpisodeView } from './tmdb.types.js';

type EpisodeLike = {
  seasonNumber: number;
  episodeNumber: number;
  title: string | null;
  releaseDate: string | null;
};

export function findNextEpisode<T extends EpisodeLike>(params: {
  currentSeasonNumber: number;
  currentEpisodeNumber: number;
  episodes: T[];
  watchedKeys?: string[] | null;
  showId?: string | null;
  nowMs?: number | null;
}): T | null {
  const sorted = [...params.episodes].sort((left, right) => {
    if (left.seasonNumber !== right.seasonNumber) {
      return left.seasonNumber - right.seasonNumber;
    }
    return left.episodeNumber - right.episodeNumber;
  });

  const watched = new Set((params.watchedKeys ?? []).map((value) => value.trim()).filter(Boolean));
  const showIds = normalizedShowIds(params.showId);

  for (const episode of sorted) {
    if (episode.seasonNumber < params.currentSeasonNumber) {
      continue;
    }
    if (episode.seasonNumber === params.currentSeasonNumber && episode.episodeNumber <= params.currentEpisodeNumber) {
      continue;
    }
    if (isWatchedEpisode(watched, showIds, episode.seasonNumber, episode.episodeNumber)) {
      continue;
    }
    if (!isReleasedEpisode(episode.releaseDate, params.nowMs ?? null)) {
      continue;
    }
    return episode;
  }

  return null;
}

export function episodeViewToLookup(episode: MetadataEpisodeView): EpisodeLike {
  return {
    seasonNumber: episode.seasonNumber,
    episodeNumber: episode.episodeNumber,
    title: episode.title,
    releaseDate: episode.airDate,
  };
}

function normalizedShowIds(showId: string | null | undefined): string[] {
  const trimmed = showId?.trim();
  if (!trimmed) {
    return [];
  }

  const normalized = trimmed.startsWith('tt') ? trimmed : `tt${trimmed}`;
  return normalized === trimmed ? [trimmed] : [trimmed, normalized];
}

function isWatchedEpisode(
  watched: Set<string>,
  showIds: string[],
  seasonNumber: number,
  episodeNumber: number,
): boolean {
  if (watched.size === 0 || showIds.length === 0) {
    return false;
  }

  for (const showId of showIds) {
    if (watched.has(`${showId}:${seasonNumber}:${episodeNumber}`)) {
      return true;
    }
  }

  return false;
}

function isReleasedEpisode(releaseDate: string | null, nowMs: number | null): boolean {
  const trimmed = releaseDate?.trim();
  if (!trimmed) {
    return false;
  }

  const now = nowMs === null ? Date.now() : nowMs;
  const isoTimestamp = Date.parse(trimmed);
  if (Number.isFinite(isoTimestamp)) {
    return isoTimestamp <= now;
  }

  const dayTimestamp = Date.parse(`${trimmed.slice(0, 10)}T00:00:00.000Z`);
  if (!Number.isFinite(dayTimestamp)) {
    return false;
  }

  const nowDayTimestamp = Date.parse(new Date(now).toISOString().slice(0, 10) + 'T23:59:59.999Z');
  return dayTimestamp <= nowDayTimestamp;
}
