import test from 'node:test';
import assert from 'node:assert/strict';
import {
  type EpisodeSeasonRef,
  type LastWatchedRef,
  nextReleasedEpisodeAfter,
  shouldSurfaceNextEpisode,
} from './episodic-follow-policy.js';

const TODAY = '2026-08-18';

function ep(season: number, episode: number, airDate: string | null): EpisodeSeasonRef {
  return { seasonNumber: season, episodeNumber: episode, airDate, tmdbId: null };
}

test('surfaces next aired episode in same season after watched', () => {
  const ok = shouldSurfaceNextEpisode({
    watchedSeasonNumber: 2,
    candidateSeasonNumber: 2,
    candidateAirDate: '2026-08-10',
    todayIso: TODAY,
    showUnairedNextUp: false,
    available: true,
  });
  assert.equal(ok, true);
});

test('hides unaired same-season episode when showUnairedNextUp is off', () => {
  const ok = shouldSurfaceNextEpisode({
    watchedSeasonNumber: 2,
    candidateSeasonNumber: 2,
    candidateAirDate: '2026-09-01',
    todayIso: TODAY,
    showUnairedNextUp: false,
    available: true,
  });
  assert.equal(ok, false);
});

test('shows unaired same-season episode when showUnairedNextUp is on', () => {
  const ok = shouldSurfaceNextEpisode({
    watchedSeasonNumber: 2,
    candidateSeasonNumber: 2,
    candidateAirDate: '2026-09-01',
    todayIso: TODAY,
    showUnairedNextUp: true,
    available: true,
  });
  assert.equal(ok, true);
});

test('hides season rollover unaired episode by default (window needs showUnairedNextUp)', () => {
  const ok = shouldSurfaceNextEpisode({
    watchedSeasonNumber: 2,
    candidateSeasonNumber: 3,
    candidateAirDate: '2026-08-21',
    todayIso: TODAY,
    showUnairedNextUp: false,
    available: true,
  });
  assert.equal(ok, false);
});

test('shows season rollover unaired episode within 7-day window when showUnairedNextUp is on', () => {
  const ok = shouldSurfaceNextEpisode({
    watchedSeasonNumber: 2,
    candidateSeasonNumber: 3,
    candidateAirDate: '2026-08-21',
    todayIso: TODAY,
    showUnairedNextUp: true,
    available: true,
  });
  assert.equal(ok, true);
});

test('hides season rollover episode beyond 7-day window by default', () => {
  const ok = shouldSurfaceNextEpisode({
    watchedSeasonNumber: 2,
    candidateSeasonNumber: 3,
    candidateAirDate: '2026-12-01',
    todayIso: TODAY,
    showUnairedNextUp: false,
    available: true,
  });
  assert.equal(ok, false);
});

test('nextReleasedEpisodeAfter returns next episode after watched', () => {
  const episodes = [ep(1, 1, '2026-01-01'), ep(2, 9, '2026-08-01'), ep(2, 10, '2026-08-08'), ep(2, 11, '2026-08-15')];
  const lastWatched: LastWatchedRef = { seasonNumber: 2, episodeNumber: 9 };
  const next = nextReleasedEpisodeAfter({ episodes, lastWatched, todayIso: TODAY, showUnairedNextUp: false });
  assert.deepEqual({ season: next?.seasonNumber, episode: next?.episodeNumber }, { season: 2, episode: 10 });
});

test('nextReleasedEpisodeAfter returns null when no last watched', () => {
  const episodes = [ep(1, 1, '2026-01-01')];
  const next = nextReleasedEpisodeAfter({ episodes, lastWatched: null, todayIso: TODAY, showUnairedNextUp: false });
  assert.equal(next, null);
});

test('nextReleasedEpisodeAfter returns null when all caught up', () => {
  const episodes = [ep(2, 9, '2026-08-01'), ep(2, 10, '2026-08-08')];
  const lastWatched: LastWatchedRef = { seasonNumber: 2, episodeNumber: 10 };
  const next = nextReleasedEpisodeAfter({ episodes, lastWatched, todayIso: TODAY, showUnairedNextUp: false });
  assert.equal(next, null);
});

test('nextReleasedEpisodeAfter hides unaired next when showUnairedNextUp is off', () => {
  const episodes = [ep(2, 9, '2026-08-01'), ep(2, 10, '2026-12-01')];
  const lastWatched: LastWatchedRef = { seasonNumber: 2, episodeNumber: 9 };
  const next = nextReleasedEpisodeAfter({ episodes, lastWatched, todayIso: TODAY, showUnairedNextUp: false });
  assert.equal(next, null);
});
