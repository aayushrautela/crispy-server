import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from './errors.js';
import {
  normalizeDateOnlyString,
  normalizeIsoString,
  normalizeOptionalIsoString,
  nowIso,
  requireDbIsoString,
  requireNormalizedIsoString,
  toDbIsoString,
  toIsoString,
} from './time.js';

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

test('toIsoString throws for invalid timestamps', () => {
  assert.throws(() => toIsoString('not-a-date'));
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

test('normalizeDateOnlyString preserves date-only values and normalizes Date inputs', () => {
  assert.equal(normalizeDateOnlyString('2024-06-15'), '2024-06-15');
  assert.equal(normalizeDateOnlyString('Sat Jun 15 2024 00:00:00 GMT+0000 (Coordinated Universal Time)'), '2024-06-15');
  assert.equal(normalizeDateOnlyString(new Date('2024-06-15T12:00:00.000Z')), '2024-06-15');
  assert.equal(normalizeDateOnlyString(''), null);
  assert.equal(normalizeDateOnlyString('not-a-date'), null);
});

test('toDbIsoString normalizes Date and string DB values', () => {
  const date = new Date('2024-06-15T12:00:00.000Z');
  assert.equal(toDbIsoString(date, 'createdAt'), '2024-06-15T12:00:00.000Z');
  assert.equal(toDbIsoString('2024-01-15 10:30:00+00', 'createdAt'), '2024-01-15T10:30:00.000Z');
});

test('toDbIsoString returns null for nullable DB values', () => {
  assert.equal(toDbIsoString(null, 'createdAt'), null);
  assert.equal(toDbIsoString(undefined, 'createdAt'), null);
  assert.equal(toDbIsoString('   ', 'createdAt'), null);
});

test('toDbIsoString throws for invalid DB timestamps', () => {
  assert.throws(
    () => toDbIsoString('not-a-date', 'createdAt'),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, 'Invalid DB timestamp for createdAt.');
      return true;
    },
  );
});

test('requireDbIsoString throws when DB timestamp is missing', () => {
  assert.throws(
    () => requireDbIsoString(null, 'createdAt'),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, 'Missing DB timestamp for createdAt.');
      return true;
    },
  );
});

test('requireDbIsoString normalizes DB Date values', () => {
  assert.equal(
    requireDbIsoString(new Date('2024-06-15T12:00:00.000Z'), 'createdAt'),
    '2024-06-15T12:00:00.000Z',
  );
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
