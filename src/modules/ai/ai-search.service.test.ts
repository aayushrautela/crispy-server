import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

test('buildResolutionQueryVariants keeps only distinct normalized query variants', async () => {
  const { buildResolutionQueryVariants } = await import('./ai-search.service.js');

  assert.deepEqual(buildResolutionQueryVariants('Spider-Man: Into the Spider-Verse (2018)'), [
    'Spider-Man: Into the Spider-Verse (2018)',
    'Spider-Man',
    'Spider-Man: Into the Spider-Verse',
  ]);
});

test('isSameTitleFamily keeps distinct titles that only share a leading token', async () => {
  const { isSameTitleFamily } = await import('./ai-search.service.js');

  assert.equal(isSameTitleFamily('Fantastic Beasts and Where to Find Them', 'Fantastic Mr. Fox'), false);
  assert.equal(isSameTitleFamily('The Lord of the Rings: The Fellowship of the Ring', 'The Lord of the Rings: The Two Towers'), true);
});
