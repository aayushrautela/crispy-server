export type EpisodeSeasonRef = {
  seasonNumber: number;
  episodeNumber: number;
  airDate: string | null;
  tmdbId: number | null;
};

export type LastWatchedRef = {
  seasonNumber: number | null;
  episodeNumber: number | null;
};

const UPCOMING_NEXT_SEASON_WINDOW_DAYS = 7;

function normalizeSeasonNumber(season: number | null | undefined): number {
  if (season == null || season <= 0) {
    return 0;
  }

  return season;
}

export function daysUntilRelease(releaseDate: string | null, todayIso: string): number | null {
  if (!releaseDate) {
    return null;
  }

  const release = Date.parse(releaseDate);
  const today = Date.parse(todayIso);
  if (Number.isNaN(release) || Number.isNaN(today)) {
    return null;
  }

  return Math.floor((release - today) / (24 * 60 * 60 * 1000));
}

export function shouldSurfaceNextEpisode(params: {
  watchedSeasonNumber: number | null;
  candidateSeasonNumber: number;
  candidateAirDate: string | null;
  todayIso: string;
  showUnairedNextUp: boolean;
  available: boolean;
}): boolean {
  const watchedSeason = normalizeSeasonNumber(params.watchedSeasonNumber);
  const candidateSeason = normalizeSeasonNumber(params.candidateSeasonNumber);
  const isSeasonRollover = candidateSeason !== watchedSeason;

  if (!params.available) {
    const days = daysUntilRelease(params.candidateAirDate, params.todayIso);
    if (days == null) {
      return !isSeasonRollover;
    }
    if (days <= 0) {
      return true;
    }
    if (!params.showUnairedNextUp) {
      return false;
    }
    return !isSeasonRollover || days <= UPCOMING_NEXT_SEASON_WINDOW_DAYS;
  }

  if (!isSeasonRollover) {
    if (params.showUnairedNextUp) {
      return true;
    }
    const days = daysUntilRelease(params.candidateAirDate, params.todayIso);
    if (days == null) {
      return true;
    }
    return days <= 0;
  }

  const daysExplicit = daysUntilRelease(params.candidateAirDate, params.todayIso);
  if (daysExplicit != null && daysExplicit <= 0) {
    return true;
  }
  if (!params.showUnairedNextUp) {
    return false;
  }
  const days = daysUntilRelease(params.candidateAirDate, params.todayIso);
  if (days == null) {
    return false;
  }
  return days <= UPCOMING_NEXT_SEASON_WINDOW_DAYS;
}

export function nextReleasedEpisodeAfter(params: {
  episodes: EpisodeSeasonRef[];
  lastWatched: LastWatchedRef | null;
  todayIso: string;
  showUnairedNextUp: boolean;
}): EpisodeSeasonRef | null {
  const watchedEpisode = params.lastWatched?.episodeNumber ?? null;
  if (watchedEpisode == null) {
    return null;
  }

  const watchedSeason = normalizeSeasonNumber(params.lastWatched?.seasonNumber ?? null);

  let candidate: EpisodeSeasonRef | null = null;
  for (const episode of params.episodes) {
    const episodeSeason = normalizeSeasonNumber(episode.seasonNumber);
    if (episodeSeason < watchedSeason) {
      continue;
    }
    if (episodeSeason === watchedSeason && episode.episodeNumber <= watchedEpisode) {
      continue;
    }
    candidate = episode;
    break;
  }

  if (!candidate) {
    return null;
  }

  const surface = shouldSurfaceNextEpisode({
    watchedSeasonNumber: params.lastWatched?.seasonNumber ?? null,
    candidateSeasonNumber: candidate.seasonNumber,
    candidateAirDate: candidate.airDate,
    todayIso: params.todayIso,
    showUnairedNextUp: params.showUnairedNextUp,
    available: true,
  });

  return surface ? candidate : null;
}
