import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpError, assertPresent } from './errors.js';

test('HttpError stores statusCode, message, and optional details', () => {
  const error = new HttpError(404, 'Not found');
  assert.equal(error.statusCode, 404);
  assert.equal(error.message, 'Not found');
  assert.equal(error.details, undefined);
  assert.ok(error instanceof Error);
});

test('HttpError stores details when provided', () => {
  const details = { field: 'id', reason: 'missing' };
  const error = new HttpError(422, 'Validation failed', details);
  assert.equal(error.statusCode, 422);
  assert.deepEqual(error.details, details);
});

test('assertPresent returns value when present', () => {
  assert.equal(assertPresent('hello', 'missing'), 'hello');
  assert.equal(assertPresent(0, 'missing'), 0);
  assert.equal(assertPresent(false, 'missing'), false);
  assert.deepEqual(assertPresent({ a: 1 }, 'missing'), { a: 1 });
});

test('assertPresent throws 404 HttpError for null', () => {
  assert.throws(
    () => assertPresent(null, 'Item not found'),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 404);
      assert.equal(error.message, 'Item not found');
      return true;
    },
  );
});

test('assertPresent throws 404 HttpError for undefined', () => {
  assert.throws(
    () => assertPresent(undefined, 'Item not found'),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 404);
      return true;
    },
  );
});
