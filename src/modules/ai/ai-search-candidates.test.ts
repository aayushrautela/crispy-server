import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSearchCandidates } from './ai-search-candidates.js';

test('parseSearchCandidates keeps title and normalized media type hints', () => {
  const candidates = parseSearchCandidates([
    { title: 'Fantastic Beasts and Where to Find Them', mediaType: 'movie' },
    { title: 'The Owl House', media_type: 'TV Show' },
    { title: 'Fullmetal Alchemist: Brotherhood', type: 'anime' },
  ]);

  assert.deepEqual(candidates, [
    { title: 'Fantastic Beasts and Where to Find Them', mediaType: 'movie', year: null },
    { title: 'The Owl House', mediaType: 'show', year: null },
    { title: 'Fullmetal Alchemist: Brotherhood', mediaType: 'show', year: null },
  ]);
});

test('parseSearchCandidates dedupes by title, media type, and year while preserving plain strings', () => {
  const candidates = parseSearchCandidates([
    'Spirited Away',
    { title: 'Spirited Away' },
    { title: 'Spirited Away', mediaType: 'anime' },
    { title: '  "Spirited Away"  ', mediaType: 'anime' },
  ]);

  assert.deepEqual(candidates, [
    { title: 'Spirited Away', mediaType: null, year: null },
    { title: 'Spirited Away', mediaType: 'show', year: null },
  ]);
});

test('parseSearchCandidates extracts year from year / releaseYear / release_year', () => {
  const candidates = parseSearchCandidates([
    { title: 'Blade Runner', mediaType: 'movie', year: 1982 },
    { title: 'The Matrix', mediaType: 'movie', releaseYear: 1999 },
    { title: 'Akira', mediaType: 'movie', release_year: '1988' },
    { title: 'Dark City', mediaType: 'movie', year: 'made in 1998' },
    { title: 'Snowpiercer', mediaType: 'movie', year: null },
    { title: 'Brazil', mediaType: 'movie', year: 'not-a-year' },
  ]);

  assert.deepEqual(candidates, [
    { title: 'Blade Runner', mediaType: 'movie', year: 1982 },
    { title: 'The Matrix', mediaType: 'movie', year: 1999 },
    { title: 'Akira', mediaType: 'movie', year: 1988 },
    { title: 'Dark City', mediaType: 'movie', year: 1998 },
    { title: 'Snowpiercer', mediaType: 'movie', year: null },
    { title: 'Brazil', mediaType: 'movie', year: null },
  ]);
});

test('parseSearchCandidates keeps same-titled candidates distinct when years differ', () => {
  const candidates = parseSearchCandidates([
    { title: 'Brazil', mediaType: 'movie', year: 1985 },
    { title: 'Brazil', mediaType: 'movie', year: 1994 },
    { title: 'Brazil', mediaType: 'movie' },
  ]);

  assert.deepEqual(candidates, [
    { title: 'Brazil', mediaType: 'movie', year: 1985 },
    { title: 'Brazil', mediaType: 'movie', year: 1994 },
    { title: 'Brazil', mediaType: 'movie', year: null },
  ]);
});

