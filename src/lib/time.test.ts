import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from './errors.js';
import { normalizeIsoString, normalizeOptionalIsoString, requireNormalizedIsoString, toIsoString, nowIso } from './time.js';

test('nowIso returns a valid ISO string', () => {
  const result = nowIso();
  const parsed = new Date(result);
  assert.ok(!Number.isNaN(parsed.getTime()));
  assert.equal(result, parsed.toISOString());
});

test('toIsoString converts Date to ISO string', () => {
  const date = new Date('2024-01-15T10:30:00.000Z');
  assert.equal(toIsoString(date), '2024-01-15T10:30:00.000Z');
});

test('toIsoString parses string input to ISO string', () => {
  assert.equal(toIsoString('2024-01-15T10:30:00.000Z'), '2024-01-15T10:30:00.000Z');
});

test('normalizeIsoString converts parseable timestamps', () => {
  assert.equal(
    normalizeIsoString('Wed Aug 09 2023 16:57:00 GMT+0000 (Coordinated Universal Time)'),
    '2023-08-09T16:57:00.000Z',
  );
  assert.equal(normalizeIsoString('2024-01-15T10:30:00.000Z'), '2024-01-15T10:30:00.000Z');
});

test('normalizeIsoString returns null for invalid timestamps', () => {
  assert.equal(normalizeIsoString('not-a-date'), null);
  assert.equal(normalizeIsoString(''), null);
});

test('normalizeIsoString returns null for null and undefined', () => {
  assert.equal(normalizeIsoString(null), null);
  assert.equal(normalizeIsoString(undefined), null);
});

test('normalizeIsoString handles Date objects', () => {
  const date = new Date('2024-06-15T12:00:00.000Z');
  assert.equal(normalizeIsoString(date), '2024-06-15T12:00:00.000Z');
});

test('normalizeOptionalIsoString returns null for blank values', () => {
  assert.equal(normalizeOptionalIsoString('', 'occurredAt'), null);
  assert.equal(normalizeOptionalIsoString('   ', 'occurredAt'), null);
  assert.equal(normalizeOptionalIsoString(null, 'occurredAt'), null);
});

test('requireNormalizedIsoString throws HttpError for invalid timestamps', () => {
  assert.throws(
    () => requireNormalizedIsoString('not-a-date', 'occurredAt'),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, 'invalid_timestamp');
      assert.equal(error.message, 'Invalid occurredAt timestamp.');
      assert.deepEqual(error.details, { field: 'occurredAt', value: 'not-a-date' });
      return true;
    },
  );
});
