import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeIsoString } from './time.js';

test('normalizeIsoString converts parseable timestamps to ISO strings', () => {
  assert.equal(
    normalizeIsoString('Wed Aug 09 2023 16:57:00 GMT+0000 (Coordinated Universal Time)'),
    '2023-08-09T16:57:00.000Z',
  );
});

test('normalizeIsoString returns null for invalid timestamps', () => {
  assert.equal(normalizeIsoString('not-a-date'), null);
});
