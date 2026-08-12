import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';
import type { TmdbTitleRecord } from '../metadata/providers/tmdb.types.js';

seedTestEnv();

function makeTitle(overrides: Partial<TmdbTitleRecord> = {}): TmdbTitleRecord {
  return {
    mediaType: 'movie',
    tmdbId: 1,
    language: 'en',
    name: 'Example Title',
    originalName: 'Example Title',
    overview: null,
    tagline: null,
    releaseDate: '2020-01-01',
    firstAirDate: null,
    status: null,
    posterPath: null,
    backdropPath: null,
    runtime: null,
    episodeRunTime: [],
    numberOfSeasons: null,
    numberOfEpisodes: null,
    externalIds: {},
    raw: {},
    fetchedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2099-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('rankAiMatches returns all matches sorted by score', async () => {
  const { rankAiMatches } = await import('./title-search.service.js');
  const matches = [
    makeTitle({ tmdbId: 1, name: 'Dune', originalName: 'Dune' }),
    makeTitle({ tmdbId: 2, name: 'The Matrix', originalName: 'The Matrix' }),
    makeTitle({ tmdbId: 3, name: 'Blade Runner', originalName: 'Blade Runner' }),
  ];

  const ranked = rankAiMatches('the matrix', matches);

  assert.equal(ranked.length, 3);
  assert.equal(ranked[0]?.match.tmdbId, 2);
  assert.equal(ranked[0]?.score, 0);
});

test('scoreAiMatch returns exact score for name match', async () => {
  const { scoreAiMatch } = await import('./title-search.service.js');
  const match = makeTitle({ name: 'The Matrix', originalName: 'The Matrix' });
  assert.equal(scoreAiMatch('the matrix', match), 0);
});

test('scoreAiMatch returns exact score for originalName match', async () => {
  const { scoreAiMatch } = await import('./title-search.service.js');
  const match = makeTitle({ name: 'Train to Busan', originalName: 'Busanhaeng' });
  assert.equal(scoreAiMatch('busanhaeng', match), 0);
});

test('scoreAiMatch resolves typo via character similarity', async () => {
  const { scoreAiMatch } = await import('./title-search.service.js');
  const match = makeTitle({ name: 'Blade Runner', originalName: 'Blade Runner' });
  assert.equal(scoreAiMatch('bladerunner', match), 1);
});

test('scoreAiMatch resolves word split via character similarity', async () => {
  const { scoreAiMatch } = await import('./title-search.service.js');
  const match = makeTitle({ name: 'Spider-Man', originalName: 'Spider-Man' });
  assert.equal(scoreAiMatch('spiderman', match), 1);
});

test('scoreAiMatch returns near-exact for token subset', async () => {
  const { scoreAiMatch } = await import('./title-search.service.js');
  const match = makeTitle({ name: 'Dark Knight Rises', originalName: 'Dark Knight Rises' });
  assert.equal(scoreAiMatch('dark knight', match), 1);
});

test('scoreAiMatch returns majority token score', async () => {
  const { scoreAiMatch } = await import('./title-search.service.js');
  const match = makeTitle({ name: 'Dark Knight', originalName: 'Dark Knight' });
  assert.equal(scoreAiMatch('dark knight rises', match), 2);
});

test('scoreAiMatch returns some-token score', async () => {
  const { scoreAiMatch } = await import('./title-search.service.js');
  const match = makeTitle({ name: 'The Matrix', originalName: 'The Matrix' });
  assert.equal(scoreAiMatch('good matrix movie', match), 3);
});

test('scoreAiMatch returns no-match for unrelated title', async () => {
  const { scoreAiMatch } = await import('./title-search.service.js');
  const match = makeTitle({ name: 'The Fast and the Furious', originalName: 'The Fast and the Furious' });
  assert.equal(scoreAiMatch('dune', match), 10);
});

test('rankAiMatches with empty input returns empty array', async () => {
  const { rankAiMatches } = await import('./title-search.service.js');
  assert.deepEqual(rankAiMatches('anything', []), []);
});

test('characterSimilarity of identical strings is 1', async () => {
  const { characterSimilarity } = await import('./title-search.service.js');
  assert.equal(characterSimilarity('dune', 'dune'), 1);
});

test('characterSimilarity of empty strings is 0', async () => {
  const { characterSimilarity } = await import('./title-search.service.js');
  assert.equal(characterSimilarity('', ''), 0);
});

test('characterSimilarity of unrelated strings is low', async () => {
  const { characterSimilarity } = await import('./title-search.service.js');
  assert.ok(characterSimilarity('dune', 'furious') < 0.3);
});

test('tokenOverlapScore returns near-exact when all query tokens present', async () => {
  const { tokenOverlapScore } = await import('./title-search.service.js');
  assert.equal(tokenOverlapScore(['the', 'matrix'], 'the matrix reloaded'), 1);
});

test('tokenOverlapScore returns majority when half or more tokens shared', async () => {
  const { tokenOverlapScore } = await import('./title-search.service.js');
  assert.equal(tokenOverlapScore(['dark', 'knight', 'rises'], 'dark knight'), 2);
});

test('tokenOverlapScore returns some when at least one token shared below majority', async () => {
  const { tokenOverlapScore } = await import('./title-search.service.js');
  assert.equal(tokenOverlapScore(['inception', 'nolan', 'scifi'], 'inception'), 3);
});

test('tokenOverlapScore returns no-match when nothing shared', async () => {
  const { tokenOverlapScore } = await import('./title-search.service.js');
  assert.equal(tokenOverlapScore(['blade', 'runner'], 'dune'), 10);
});

test('titleYear parses releaseDate year and ignores nulls', async () => {
  const { titleYear } = await import('./title-search.service.js');
  assert.equal(titleYear(makeTitle({ releaseDate: '1998-02-27', firstAirDate: null })), 1998);
  assert.equal(titleYear(makeTitle({ releaseDate: null, firstAirDate: '2018-01-15' })), 2018);
  assert.equal(titleYear(makeTitle({ releaseDate: null, firstAirDate: null })), null);
});

test('selectAiMatchWinner returns the single absolute match alone', async () => {
  const { selectAiMatchWinner } = await import('./title-search.service.js');
  const ranked = [
    { match: makeTitle({ tmdbId: 1, name: 'Dark City', originalName: 'Dark City', releaseDate: '1998-02-27' }), score: 0 },
    { match: makeTitle({ tmdbId: 2, name: 'Desperate Souls: Dark City and the Legend of Midnight Cowboy', originalName: 'x', releaseDate: null }), score: 1 },
    { match: makeTitle({ tmdbId: 3, name: 'Brazil', originalName: 'Brazil', releaseDate: null }), score: 10 },
  ];
  const winner = selectAiMatchWinner(ranked, null);
  assert.ok(winner);
  assert.equal(winner?.match.tmdbId, 1);
});

test('selectAiMatchWinner prefers the fuzzy match when nothing is exact', async () => {
  const { selectAiMatchWinner } = await import('./title-search.service.js');
  const ranked = [
    { match: makeTitle({ tmdbId: 1, name: 'Twelve Monkeys', originalName: '12 Monkeys', releaseDate: '1995-12-29' }), score: 1 },
    { match: makeTitle({ tmdbId: 2, name: '12 Monkeys Diaries', originalName: 'x', releaseDate: null }), score: 2 },
  ];
  const winner = selectAiMatchWinner(ranked, null);
  assert.ok(winner);
  assert.equal(winner?.match.tmdbId, 1);
});

test('selectAiMatchWinner returns null when everything scores above the fuzzy cutoff', async () => {
  const { selectAiMatchWinner } = await import('./title-search.service.js');
  const ranked = [
    { match: makeTitle({ tmdbId: 4, name: 'Unrelated', originalName: 'x', releaseDate: null }), score: 10 },
  ];
  assert.equal(selectAiMatchWinner(ranked, null), null);
});

test('selectAiMatchWinner returns null for empty ranking', async () => {
  const { selectAiMatchWinner } = await import('./title-search.service.js');
  assert.equal(selectAiMatchWinner([], null), null);
});

test('selectAiMatchWinner tie-breaks identical exact scores toward the dated title when year is absent', async () => {
  const { selectAiMatchWinner } = await import('./title-search.service.js');
  const ranked = [
    { match: makeTitle({ tmdbId: 1, name: 'Brazil', originalName: 'Brazil', releaseDate: null }), score: 0 },
    { match: makeTitle({ tmdbId: 2, name: 'Brazil', originalName: 'Brazil', releaseDate: '1985-02-20' }), score: 0 },
  ];
  const winner = selectAiMatchWinner(ranked, null);
  assert.ok(winner);
  assert.equal(winner?.match.tmdbId, 2);
});

test('selectAiMatchWinner tie-breaks identical exact scores using year when provided', async () => {
  const { selectAiMatchWinner } = await import('./title-search.service.js');
  const ranked = [
    { match: makeTitle({ tmdbId: 1, name: 'Brazil', originalName: 'Brazil', releaseDate: '1985-02-20' }), score: 0 },
    { match: makeTitle({ tmdbId: 2, name: 'Brazil', originalName: 'Brazil', releaseDate: '1994-01-01' }), score: 0 },
    { match: makeTitle({ tmdbId: 3, name: 'Brazil', originalName: 'Brazil', releaseDate: '1973-04-04' }), score: 0 },
  ];
  // LLM year exactly matches the 1985 Gilliam film
  const exact = selectAiMatchWinner(ranked, 1985);
  assert.equal(exact?.match.tmdbId, 1);
  // LLM year is off by 3 years (still inside the tiebreak band) -> 1985 wins
  const approx = selectAiMatchWinner(ranked, 1988);
  assert.equal(approx?.match.tmdbId, 1);
  // LLM year far outside the band -> all candidates equally far, freshness tiebreak keeps the newest (1994)
  const far = selectAiMatchWinner(ranked, 2050);
  assert.equal(far?.match.tmdbId, 2);
});

test('selectAiMatchWinner ignores year when ranking differs by score', async () => {
  const { selectAiMatchWinner } = await import('./title-search.service.js');
  const ranked = [
    { match: makeTitle({ tmdbId: 1, name: 'Dark City', originalName: 'Dark City', releaseDate: '1998-02-27' }), score: 0 },
    { match: makeTitle({ tmdbId: 2, name: 'The Boys from Brazil', originalName: 'x', releaseDate: '1978-10-13' }), score: 1 },
  ];
  // LLM says year 1978 (matches the wrong film), but exact-name match still wins
  const winner = selectAiMatchWinner(ranked, 1978);
  assert.equal(winner?.match.tmdbId, 1);
});

