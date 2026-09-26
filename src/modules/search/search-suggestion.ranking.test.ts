import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSuggestionName, rankSuggestions, type SuggestionRow } from './search-suggestion.ranking.js';

function row(name: string, source: SuggestionRow['source'], rank: number): SuggestionRow {
  return { source, name, normalizedName: normalizeSuggestionName(name), rank };
}

test('normalizeSuggestionName lowercases, strips accents and collapses punctuation', () => {
  assert.equal(normalizeSuggestionName('Amélie'), 'amelie');
  assert.equal(normalizeSuggestionName('The Godfather'), 'the godfather');
  assert.equal(normalizeSuggestionName('Spider-Man: No Way Home'), 'spider man no way home');
  assert.equal(normalizeSuggestionName('  WALL·E  '), 'wall e');
  assert.equal(normalizeSuggestionName('---'), '');
});

test('normalizeSuggestionName separates words at spacing diacritics', () => {
  // U+00B7 is Diacritic-class but is real punctuation, so it must become a
  // space rather than disappear and fuse the two words.
  assert.equal(normalizeSuggestionName('Bang·Bang'), 'bang bang');
  assert.equal(normalizeSuggestionName('A´B'), 'a b');
});

test('normalizeSuggestionName makes diacritic and ascii spellings match each other', () => {
  assert.equal(normalizeSuggestionName('Amélie'), normalizeSuggestionName('Amelie'));
});

test('rankSuggestions returns an exact match ahead of prefix matches', () => {
  const rows = [row('Matrix', 'trending', 40), row('Matrix Reloaded', 'trending', 1), row('The Matrix', 'classics', 5)];

  assert.deepEqual(rankSuggestions(rows, 'Matrix', 8).map((entry) => entry.name), [
    'Matrix',
    'Matrix Reloaded',
  ]);
});

test('rankSuggestions drops a mid-name match rather than widening the query', () => {
  // "The Matrix" contains "matrix" but is not a prefix of it, and the prefix
  // index cannot serve a substring scan, so it is not offered.
  const rows = [row('The Matrix', 'trending', 1), row('Matrix', 'trending', 2)];

  assert.deepEqual(rankSuggestions(rows, 'Matrix', 8).map((entry) => entry.name), ['Matrix']);
});

test('rankSuggestions prefers the higher-priority source before the curated rank', () => {
  const rows = [row('Dune', 'classics', 1), row('Dune', 'trending', 900)];

  assert.deepEqual(rankSuggestions(rows, 'Dune', 8), [{ name: 'Dune', source: 'trending' }]);
});

test('rankSuggestions falls back to the curated rank within a source', () => {
  const rows = [row('Alien', 'classics', 90), row('Aliens', 'classics', 12), row('Alien 3', 'classics', 40)];

  // 'Alien' is an exact match, so it leads despite the worst curated rank.
  assert.deepEqual(rankSuggestions(rows, 'Alien', 8).map((entry) => entry.name), [
    'Alien',
    'Aliens',
    'Alien 3',
  ]);
});

test('rankSuggestions dedupes the same name coming from several sources', () => {
  const rows = [row('Arrival', 'trending', 3), row('Arrival', 'popular', 4), row('Arrival', 'classics', 5)];

  assert.deepEqual(rankSuggestions(rows, 'Arrival', 8), [{ name: 'Arrival', source: 'trending' }]);
});

test('rankSuggestions matches on the normalized query, not the raw one', () => {
  const rows = [row('Amélie', 'trending', 1), row('Amelie', 'popular', 2)];

  // Both spellings normalize to the same key, so each query yields one entry.
  assert.deepEqual(rankSuggestions(rows, 'AMELIE', 8), [{ name: 'Amélie', source: 'trending' }]);
  assert.deepEqual(rankSuggestions(rows, 'amélie', 8), [{ name: 'Amélie', source: 'trending' }]);
});

test('rankSuggestions keeps a non-matching row out of the results', () => {
  const rows = [row('Arrival', 'trending', 1), row('Nope', 'trending', 2)];

  assert.deepEqual(rankSuggestions(rows, 'Arrival', 8).map((entry) => entry.name), ['Arrival']);
});

test('rankSuggestions matches mid-name words through prefix matching', () => {
  const rows = [row('The Godfather', 'classics', 1), row('The Thing', 'classics', 2)];

  assert.deepEqual(rankSuggestions(rows, 'the', 8).map((entry) => entry.name), [
    'The Godfather',
    'The Thing',
  ]);
});

test('rankSuggestions returns nothing for a blank query or a non-positive limit', () => {
  const rows = [row('Arrival', 'trending', 1)];

  assert.deepEqual(rankSuggestions(rows, '   ', 8), []);
  assert.deepEqual(rankSuggestions(rows, '', 8), []);
  assert.deepEqual(rankSuggestions(rows, 'Arrival', 0), []);
  // A punctuation-only query normalizes to empty and must not match everything.
  assert.deepEqual(rankSuggestions(rows, '!!!', 8), []);
});

test('rankSuggestions honours the limit after ordering', () => {
  const rows = [row('Dune', 'trending', 1), row('Dune Part Two', 'trending', 2), row('Dunes of Mars', 'classics', 3)];

  assert.deepEqual(rankSuggestions(rows, 'Dune', 2).map((entry) => entry.name), ['Dune', 'Dune Part Two']);
});

test('rankSuggestions is stable for equal tiers so repeated calls agree', () => {
  const rows = [
    row('Blade Runner 2049', 'classics', 1),
    row('Blade Runner', 'classics', 1),
  ];

  const first = rankSuggestions(rows, 'Blade', 8).map((entry) => entry.name);
  const second = rankSuggestions([...rows].reverse(), 'Blade', 8).map((entry) => entry.name);

  assert.deepEqual(first, second);
});
