import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSearchCandidates, resolveCandidateFilter } from './ai-search-candidates.js';

test('parseSearchCandidates keeps title and normalized media type hints', () => {
  const candidates = parseSearchCandidates([
    { title: 'Fantastic Beasts and Where to Find Them', mediaType: 'movie' },
    { title: 'The Owl House', media_type: 'TV Show' },
    { title: 'Fullmetal Alchemist: Brotherhood', type: 'anime' },
  ]);

  assert.deepEqual(candidates, [
    { title: 'Fantastic Beasts and Where to Find Them', mediaType: 'movie' },
    { title: 'The Owl House', mediaType: 'show' },
    { title: 'Fullmetal Alchemist: Brotherhood', mediaType: 'show' },
  ]);
});

test('parseSearchCandidates dedupes by title and media type while preserving plain strings', () => {
  const candidates = parseSearchCandidates([
    'Spirited Away',
    { title: 'Spirited Away' },
    { title: 'Spirited Away', mediaType: 'anime' },
    { title: '  "Spirited Away"  ', mediaType: 'anime' },
  ]);

  assert.deepEqual(candidates, [
    { title: 'Spirited Away', mediaType: null },
    { title: 'Spirited Away', mediaType: 'show' },
  ]);
});

test('resolveCandidateFilter uses only movie and series filters', () => {
  assert.deepEqual(resolveCandidateFilter('movie'), ['movies']);
  assert.deepEqual(resolveCandidateFilter('show'), ['series']);
  assert.deepEqual(resolveCandidateFilter(null), ['movies', 'series']);
});
