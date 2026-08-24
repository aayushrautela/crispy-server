import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveCalendarBuckets } from './calendar-buckets.js';

const NOW = new Date('2026-08-19T12:00:00.000Z');

test('resolveCalendarBuckets assigns up_next to the first unaired episode per series', () => {
  const buckets = resolveCalendarBuckets([
    { showItemId: 'show-a', airDate: '2026-08-20' },
    { showItemId: 'show-a', airDate: '2026-08-27' },
    { showItemId: 'show-b', airDate: '2026-08-21' },
    { showItemId: 'show-b', airDate: '2026-09-02' },
  ], NOW);

  assert.deepEqual(buckets, ['up_next', 'upcoming', 'up_next', 'upcoming']);
});

test('resolveCalendarBuckets marks already-aired episodes as recently_released', () => {
  const buckets = resolveCalendarBuckets([
    { showItemId: 'show-a', airDate: '2026-08-06' },
    { showItemId: 'show-a', airDate: '2026-08-13' },
    { showItemId: 'show-a', airDate: '2026-08-20' },
  ], NOW);

  assert.deepEqual(buckets, ['recently_released', 'recently_released', 'up_next']);
});

test('resolveCalendarBuckets groups same-week follow-ups as this_week', () => {
  const buckets = resolveCalendarBuckets([
    { showItemId: 'show-a', airDate: '2026-08-19' },
    { showItemId: 'show-a', airDate: '2026-08-21' },
    { showItemId: 'show-b', airDate: '2026-08-22' },
    { showItemId: 'show-c', airDate: '2026-08-24' },
    { showItemId: 'show-c', airDate: '2026-09-10' },
  ], NOW);

  assert.deepEqual(buckets, ['up_next', 'this_week', 'up_next', 'up_next', 'upcoming']);
});

test('resolveCalendarBuckets handles missing and unparseable air dates', () => {
  const buckets = resolveCalendarBuckets([
    { showItemId: 'show-a', airDate: null },
    { showItemId: 'show-b', airDate: 'not-a-date' },
    { showItemId: 'show-c', airDate: '2026-08-20' },
  ], NOW);

  assert.deepEqual(buckets, ['no_scheduled', 'no_scheduled', 'up_next']);
});

test('resolveCalendarBuckets treats week boundaries as Monday-based UTC weeks', () => {
  const sundayBefore = new Date('2026-08-16T12:00:00.000Z');

  const buckets = resolveCalendarBuckets([
    { showItemId: 'show-a', airDate: '2026-08-17' },
    { showItemId: 'show-a', airDate: '2026-08-18' },
    { showItemId: 'show-a', airDate: '2026-08-24' },
  ], sundayBefore);

  assert.deepEqual(buckets, ['up_next', 'this_week', 'upcoming']);
});
