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

test('isStrongMatch is true for a clean multi-token title equal to the query', async () => {
  const { isStrongMatch } = await import('./title-search.service.js');
  const match = makeTitle({ name: 'Dark City', originalName: 'Dark City' });
  assert.equal(isStrongMatch('dark city', match), true);
});

test('isStrongMatch is false for a longer phrase that merely contains every query token', async () => {
  const { isStrongMatch } = await import('./title-search.service.js');
  const match = makeTitle({
    name: 'Desperate Souls: Dark City and the Legend of Midnight Cowboy',
    originalName: 'Desperate Souls: Dark City and the Legend of Midnight Cowboy',
  });
  assert.equal(isStrongMatch('dark city', match), false);
});

test('isStrongMatch is false for a single-token query even when exact (handled by EXACT tier)', async () => {
  const { isStrongMatch } = await import('./title-search.service.js');
  const match = makeTitle({ name: 'Brazil', originalName: 'Brazil' });
  assert.equal(isStrongMatch('brazil', match), false);
});

test('isStrongMatch is false across extra-titled candidates like The Boys from Brazil', async () => {
  const { isStrongMatch } = await import('./title-search.service.js');
  const match = makeTitle({ name: 'The Boys from Brazil', originalName: 'The Boys from Brazil' });
  assert.equal(isStrongMatch('brazil', match), false);
});

test('selectAiResolutionMatches returns a single absolute match when one exists', async () => {
  const { selectAiResolutionMatches } = await import('./title-search.service.js');
  const ranked = [
    { match: makeTitle({ tmdbId: 1, name: 'Dark City', originalName: 'Dark City', releaseDate: '1998-02-27' }), score: 0 },
    { match: makeTitle({ tmdbId: 2, name: 'Desperate Souls: Dark City and the Legend of Midnight Cowboy', originalName: 'x', releaseDate: null }), score: 1 },
    { match: makeTitle({ tmdbId: 3, name: 'Brazil', originalName: 'Brazil', releaseDate: null }), score: 10 },
  ];
  const selected = selectAiResolutionMatches('dark city', ranked);
  assert.equal(selected.length, 1);
  assert.equal(selected[0]?.match.tmdbId, 1);
});

test('selectAiResolutionMatches returns a single strong match when no absolute match exists', async () => {
  const { selectAiResolutionMatches } = await import('./title-search.service.js');
  const ranked = [
    { match: makeTitle({ tmdbId: 1, name: 'Twelve Monkeys', originalName: '12 Monkeys', releaseDate: '1995-12-29' }), score: 1 },
    { match: makeTitle({ tmdbId: 2, name: '12 Monkeys (Metaphor)', originalName: 'x', releaseDate: null }), score: 1 },
  ];
  const selected = selectAiResolutionMatches('12 monkeys', ranked);
  assert.equal(selected.length, 1);
  assert.equal(selected[0]?.match.tmdbId, 1);
});

test('selectAiResolutionMatches keeps up to three fuzzy fallbacks when no confident match exists', async () => {
  const { selectAiResolutionMatches } = await import('./title-search.service.js');
  const ranked = [
    { match: makeTitle({ tmdbId: 1, name: 'Snowpiercer', originalName: 'Snowpiercer', releaseDate: '2013-08-07' }), score: 2 },
    { match: makeTitle({ tmdbId: 2, name: 'The Snowpiercer Diaries', originalName: 'x', releaseDate: null }), score: 2 },
    { match: makeTitle({ tmdbId: 3, name: 'Snowpiercer Reborn', originalName: 'x', releaseDate: null }), score: 3 },
    { match: makeTitle({ tmdbId: 4, name: 'Unrelated', originalName: 'x', releaseDate: null }), score: 10 },
  ];
  const selected = selectAiResolutionMatches('snowpiercer darker', ranked);
  assert.equal(selected.length, 3);
  assert.equal(selected[0]?.match.tmdbId, 1);
});

test('selectAiResolutionMatches returns empty for an empty ranking', async () => {
  const { selectAiResolutionMatches } = await import('./title-search.service.js');
  assert.deepEqual(selectAiResolutionMatches('anything', []), []);
});

test('selectAiResolutionMatches tie-breaks identical absolute scores toward the dated title', async () => {
  const { selectAiResolutionMatches } = await import('./title-search.service.js');
  const ranked = [
    { match: makeTitle({ tmdbId: 1, name: 'Brazil', originalName: 'Brazil', releaseDate: null }), score: 0 },
    { match: makeTitle({ tmdbId: 2, name: 'Brazil', originalName: 'Brazil', releaseDate: '1985-02-20' }), score: 0 },
  ];
  const selected = selectAiResolutionMatches('brazil', ranked);
  assert.equal(selected.length, 1);
  assert.equal(selected[0]?.match.tmdbId, 2);
});

