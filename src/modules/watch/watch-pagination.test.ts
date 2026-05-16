import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeWatchPageCursor, decodeWatchPageCursor } from './watch-pagination.js';

test('watch page cursor encodes Date sort values as ISO timestamps', () => {
  const cursor = encodeWatchPageCursor({
    sortValue: new Date('2026-01-01T04:14:00.000Z'),
    tieBreaker: 'acaca1e5-d16f-4d35-8173-7d2bca1f2124',
  });

  assert.deepEqual(decodeWatchPageCursor(cursor), {
    sortValue: '2026-01-01T04:14:00.000Z',
    tieBreaker: 'acaca1e5-d16f-4d35-8173-7d2bca1f2124',
  });
});
