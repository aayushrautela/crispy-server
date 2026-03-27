import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from '../../lib/errors.js';
import { normalizeWatchOccurredAt, sanitizeWatchEventInput } from './watch.types.js';

test('sanitizeWatchEventInput trims strings and normalizes occurredAt', () => {
  const result = sanitizeWatchEventInput({
    clientEventId: ' event-1 ',
    eventType: ' playback_progress_snapshot ',
    mediaKey: ' movie:tmdb:1 ',
    mediaType: ' movie ',
    occurredAt: 'Wed Aug 09 2023 16:57:00 GMT+0000 (Coordinated Universal Time)',
  });

  assert.deepEqual(result, {
    clientEventId: 'event-1',
    eventType: 'playback_progress_snapshot',
    mediaKey: 'movie:tmdb:1',
    mediaType: 'movie',
    occurredAt: '2023-08-09T16:57:00.000Z',
  });
});

test('sanitizeWatchEventInput rejects invalid occurredAt timestamps', () => {
  assert.throws(
    () => sanitizeWatchEventInput({
      clientEventId: 'event-1',
      eventType: 'playback_progress_snapshot',
      mediaType: 'movie',
      occurredAt: 'not-a-date',
    }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, 'invalid_timestamp');
      return true;
    },
  );
});

test('normalizeWatchOccurredAt returns current time for null values', () => {
  const result = normalizeWatchOccurredAt(null);
  const parsed = new Date(result);
  assert.ok(!Number.isNaN(parsed.getTime()));
  assert.equal(result, parsed.toISOString());
});

test('normalizeWatchOccurredAt normalizes parseable strings', () => {
  assert.equal(
    normalizeWatchOccurredAt('Wed Aug 09 2023 16:57:00 GMT+0000 (Coordinated Universal Time)'),
    '2023-08-09T16:57:00.000Z',
  );
});

test('normalizeWatchOccurredAt normalizes Date objects from DB-like flows', () => {
  assert.equal(
    normalizeWatchOccurredAt(new Date('2024-06-15T12:00:00.000Z') as never),
    '2024-06-15T12:00:00.000Z',
  );
});
