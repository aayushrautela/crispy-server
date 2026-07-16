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
